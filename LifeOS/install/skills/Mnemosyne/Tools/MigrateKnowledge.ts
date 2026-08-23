#!/usr/bin/env bun
/**
 * MigrateKnowledge — one-shot import of PAI MEMORY/KNOWLEDGE/ markdown into the graph.
 *
 * Walks ~/.claude/PAI/MEMORY/KNOWLEDGE/{People,Companies,Ideas,Research}/*.md,
 * parses YAML frontmatter, and asserts each file as a graph node with:
 *
 *   node_id           = /pai/knowledge/<type-bucket>/<file-slug>
 *   node_type         = /classifier/entity/{agent|collective|concept|...}
 *   epistemic_state   = frontmatter.epistemic_state ?? "putative"
 *   scope             = --scope (default: "pai:knowledge")
 *   justification     = "testimonial" (originated as human-written notes)
 *   provenance        = relative path of the markdown file
 *
 * For each [[wikilink]] in the body, asserts an edge:
 *   subject = this node, predicate = /epistemology/edge/derives_from,
 *   object = /pai/knowledge/<resolved-link>
 *
 * For each frontmatter tag, asserts an edge:
 *   subject = this node, predicate = /classifier/relationship/structural,
 *   object = /pai/tag/<tag>
 *
 * Idempotent — re-running is safe (duplicate quads are dropped by Cayley's
 * load.ignore_duplicates setting; edges are deterministic by SHA1).
 *
 * Usage:
 *   bun MigrateKnowledge.ts [--knowledge-dir <path>] [--scope <scope>] [--dry-run] [--verbose]
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { CayleyClient, type Quad } from "./CayleyClient";

const ENTITY_TYPE_TO_CLASSIFIER: Record<string, string> = {
  person: "/classifier/entity/agent/conscious",
  people: "/classifier/entity/agent/conscious",
  company: "/classifier/entity/agent/collective",
  companies: "/classifier/entity/agent/collective",
  organization: "/classifier/entity/agent/collective",
  idea: "/classifier/entity/concept",
  ideas: "/classifier/entity/concept",
  research: "/classifier/assertion/inference",
  concept: "/classifier/entity/concept",
  agent: "/classifier/entity/agent/artificial",
};

// Directory name → default entity_type fallback
const DIR_DEFAULTS: Record<string, string> = {
  People: "person",
  Companies: "company",
  Ideas: "idea",
  Research: "research",
  Agents: "agent",
};

type ParsedNote = {
  path: string;
  slug: string;
  bucket: string;
  frontmatter: Record<string, unknown>;
  body: string;
  wikilinks: string[];
  tags: string[];
};

function arg(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}

function defaultKnowledgeDir(): string {
  if (process.env.PAI_DIR) {
    return resolve(process.env.PAI_DIR, "PAI", "MEMORY", "KNOWLEDGE");
  }
  return resolve(process.env.HOME ?? "", ".claude", "PAI", "MEMORY", "KNOWLEDGE");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: text };
  const yamlBlock = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n/, "");
  const fm: Record<string, unknown> = {};
  // Minimal line-oriented YAML parser — handles scalars and inline arrays.
  // For multi-line arrays (`tags:\n  - foo\n  - bar`), also handles list items.
  const lines = yamlBlock.split("\n");
  let currentKey: string | null = null;
  let arrayBuffer: string[] | null = null;
  const flushArray = () => {
    if (currentKey && arrayBuffer !== null) {
      fm[currentKey] = arrayBuffer;
    }
    currentKey = null;
    arrayBuffer = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && arrayBuffer !== null) {
      arrayBuffer.push(stripQuotes(listMatch[1].trim()));
      continue;
    }
    flushArray();
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (val === "") {
      // Possibly multi-line array
      currentKey = key;
      arrayBuffer = [];
      continue;
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      if (inner === "") {
        fm[key] = [];
      } else {
        fm[key] = inner.split(",").map((s) => stripQuotes(s.trim()));
      }
      continue;
    }
    fm[key] = stripQuotes(val);
  }
  flushArray();
  return { frontmatter: fm, body };
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function extractWikilinks(body: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]\n|#]+?)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = m[1].trim();
    if (target) out.add(target);
  }
  return [...out];
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}

function walkMd(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith("_") || name.startsWith(".")) continue;
    const p = resolve(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkMd(p));
    } else if (st.isFile() && extname(p) === ".md") {
      out.push(p);
    }
  }
  return out;
}

function escapeLiteral(s: string): string {
  // Cayley NQuad string literals: escape backslash, double quote, newline, carriage return.
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

function bucketFromPath(knowledgeRoot: string, path: string): string {
  const rel = relative(knowledgeRoot, path);
  const parts = rel.split("/");
  return parts.length > 1 ? parts[0] : "Misc";
}

function parseNote(knowledgeRoot: string, path: string): ParsedNote | null {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  const { frontmatter, body } = parseFrontmatter(text);
  const bucket = bucketFromPath(knowledgeRoot, path);
  const baseSlug = slugify(basename(path, ".md"));
  if (!baseSlug) return null;
  return {
    path,
    slug: baseSlug,
    bucket,
    frontmatter,
    body,
    wikilinks: extractWikilinks(body),
    tags: asArray(frontmatter.tags),
  };
}

function nodeIdFor(bucket: string, slug: string): string {
  return `/pai/knowledge/${slugify(bucket)}/${slug}`;
}

function tagNodeId(tag: string): string {
  return `/pai/tag/${slugify(tag)}`;
}

function classifierFor(note: ParsedNote): string {
  const fmType = String(note.frontmatter.entity_type ?? "").toLowerCase();
  if (fmType && ENTITY_TYPE_TO_CLASSIFIER[fmType]) {
    return ENTITY_TYPE_TO_CLASSIFIER[fmType];
  }
  const dirDefault = DIR_DEFAULTS[note.bucket] ?? "concept";
  return ENTITY_TYPE_TO_CLASSIFIER[dirDefault] ?? "/classifier/entity/concept";
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function quadsForNote(
  note: ParsedNote,
  knowledgeRoot: string,
  scope: string,
  notesIndex: Map<string, string>,
): Quad[] {
  const id = nodeIdFor(note.bucket, note.slug);
  const name = String(note.frontmatter.name ?? note.frontmatter.title ?? basename(note.path, ".md"));
  const description = String(
    note.frontmatter.description ??
      note.frontmatter.summary ??
      `Imported from ${relative(knowledgeRoot, note.path)}`,
  ).slice(0, 1000);
  const classifier = classifierFor(note);
  const state = String(note.frontmatter.epistemic_state ?? "putative");
  const stateNode = `/epistemology/${state}`;
  const scopeNode = `/epistemology/scope/${scope.replace(/:/g, "_")}`;
  const provenance = relative(knowledgeRoot, note.path);
  const ts = nowIso();

  const quads: Quad[] = [
    { subject: id, predicate: "/type/object/type", object: classifier },
    { subject: id, predicate: "/type/object/name", object: `"${escapeLiteral(name)}"` },
    {
      subject: id,
      predicate: "/common/topic/description",
      object: `"${escapeLiteral(description)}"`,
    },
    { subject: id, predicate: "/epistemology/edge/has_state", object: stateNode },
    { subject: id, predicate: "/epistemology/edge/scoped_to", object: scopeNode },
    {
      subject: id,
      predicate: "/epistemology/edge/justification_type",
      object: "/epistemology/testimonial",
    },
    {
      subject: id,
      predicate: "/epistemology/edge/provenance",
      object: `"${escapeLiteral(provenance)}"`,
    },
    { subject: id, predicate: "/epistemology/edge/written_at", object: `"${ts}"` },
  ];

  // Tag edges
  for (const tag of note.tags) {
    const tagId = tagNodeId(tag);
    quads.push(
      { subject: tagId, predicate: "/type/object/type", object: "/pai/tag" },
      { subject: tagId, predicate: "/type/object/name", object: `"${escapeLiteral(tag)}"` },
      {
        subject: id,
        predicate: "/classifier/relationship/structural",
        object: tagId,
      },
    );
  }

  // Wikilink edges — resolve target via case-insensitive slug lookup; if
  // not found, point at a placeholder node we synthesize, so the link is
  // preserved even though the target may not yet exist.
  for (const link of note.wikilinks) {
    const targetSlug = slugify(link);
    const targetId = notesIndex.get(targetSlug) ?? `/pai/knowledge/_unresolved/${targetSlug}`;
    const hash = createHash("sha1")
      .update(`${id}|/epistemology/edge/derives_from|${targetId}`)
      .digest("hex")
      .slice(0, 12);
    const instanceId = `/edge/instance/${hash}`;
    quads.push(
      {
        subject: id,
        predicate: "/epistemology/edge/derives_from",
        object: targetId,
      },
      {
        subject: instanceId,
        predicate: "/type/object/type",
        object: "/epistemology/edge_instance",
      },
      {
        subject: instanceId,
        predicate: "/epistemology/edge_instance/subject",
        object: id,
      },
      {
        subject: instanceId,
        predicate: "/epistemology/edge_instance/predicate",
        object: "/epistemology/edge/derives_from",
      },
      {
        subject: instanceId,
        predicate: "/epistemology/edge_instance/object",
        object: targetId,
      },
      {
        subject: instanceId,
        predicate: "/epistemology/edge/has_state",
        object: "/epistemology/putative",
      },
      {
        subject: instanceId,
        predicate: "/epistemology/edge/scoped_to",
        object: scopeNode,
      },
    );
  }

  return quads;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const knowledgeDir = arg(argv, "--knowledge-dir") ?? defaultKnowledgeDir();
  const scope = arg(argv, "--scope") ?? "pai:knowledge";
  const dryRun = argv.includes("--dry-run");
  const verbose = argv.includes("--verbose");

  if (!statSync(knowledgeDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`KNOWLEDGE/ directory not found: ${knowledgeDir}`);
    return 1;
  }
  console.log(`Migrating from: ${knowledgeDir}`);
  console.log(`Target scope:   ${scope}`);

  const files = walkMd(knowledgeDir);
  console.log(`Found ${files.length} markdown files`);

  const notes: ParsedNote[] = [];
  for (const f of files) {
    const n = parseNote(knowledgeDir, f);
    if (n) notes.push(n);
    else if (verbose) console.log(`  skip (unparseable): ${f}`);
  }
  console.log(`Parsed ${notes.length} notes`);

  // Build slug → node_id index so wikilinks resolve to existing notes.
  const notesIndex = new Map<string, string>();
  for (const n of notes) {
    notesIndex.set(n.slug, nodeIdFor(n.bucket, n.slug));
    // also alias by case-insensitive frontmatter name
    const nm = String(n.frontmatter.name ?? "").trim();
    if (nm) notesIndex.set(slugify(nm), nodeIdFor(n.bucket, n.slug));
  }

  const client = new CayleyClient();
  if (!dryRun) {
    console.log(`Waiting for Cayley at ${client.baseUrl} …`);
    await client.waitReady(30);
  }

  let totalNodes = 0;
  let totalQuads = 0;
  for (const note of notes) {
    const quads = quadsForNote(note, knowledgeDir, scope, notesIndex);
    if (verbose) {
      console.log(`  ${note.bucket}/${note.slug} → ${quads.length} quads`);
    }
    if (!dryRun) {
      try {
        await client.writeQuadsChunked(quads);
      } catch (e) {
        console.error(`  ERROR writing ${note.path}: ${(e as Error).message}`);
        continue;
      }
    }
    totalNodes += 1;
    totalQuads += quads.length;
  }

  console.log(`\nMigration ${dryRun ? "(dry-run) " : ""}complete:`);
  console.log(`  nodes asserted: ${totalNodes}`);
  console.log(`  quads written:  ${totalQuads}`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
