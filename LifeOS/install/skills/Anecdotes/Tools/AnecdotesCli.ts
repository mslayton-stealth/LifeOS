#!/usr/bin/env bun
/**
 * AnecdotesCli — multi-command CLI for the anecdote pipeline.
 *
 * Subcommands:
 *   prompt <file>        Generate the LLM extraction prompt (--dialectic for dialogue)
 *   ingest <response>    Parse + validate JSON response → quads (--write to commit)
 *   write <quads.json>   POST a pre-built quads file to Cayley
 *   query                Filtered retrieval (--by-tag / --by-domain / --by-modality / --by-contributor / --scope)
 *   fetch-corpus         Download Project Gutenberg prototype corpus
 *
 * All commands honor CAYLEY_BASE_URL (default http://localhost:64211).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CayleyClient, escapeNodeId, stripLiteralQuotes, type Quad } from "./CayleyClient";
import { parseCandidates } from "./Extract";
import {
  buildExtractionPrompt,
  buildDialecticPrompt,
} from "./Prompts";
import {
  buildAnecdoteQuads,
  buildContributorQuads,
  nowIso,
  type ContributorStatus,
} from "./Quads";

const CORPUS_SOURCES: Array<{ slug: string; url: string; filename: string }> = [
  {
    slug: "franklin",
    url: "https://www.gutenberg.org/files/148/148-0.txt",
    filename: "pg148.txt",
  },
  {
    slug: "twain",
    url: "https://www.gutenberg.org/cache/epub/19987/pg19987.txt",
    filename: "pg19987.txt",
  },
];

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ── prompt ─────────────────────────────────────────────────────────────────

function cmdPrompt(argv: string[]): number {
  const chunkPath = argv.find((a) => !a.startsWith("--"));
  if (!chunkPath) die("usage: prompt <chunk-file> [--dialectic]");
  if (!existsSync(chunkPath)) die(`chunk file not found: ${chunkPath}`);
  const text = readFileSync(chunkPath, "utf-8");
  const out = hasFlag(argv, "--dialectic")
    ? buildDialecticPrompt(text)
    : buildExtractionPrompt(text);
  process.stdout.write(out);
  return 0;
}

// ── ingest ─────────────────────────────────────────────────────────────────

async function cmdIngest(argv: string[]): Promise<number> {
  const responsePath = argv.find((a) => !a.startsWith("--"));
  if (!responsePath) die("usage: ingest <response-file> --contributor <id> [...]");
  if (!existsSync(responsePath)) die(`response file not found: ${responsePath}`);

  const contributorId = flag(argv, "--contributor");
  if (!contributorId) die("--contributor <id> is required");
  const scope = flag(argv, "--scope") ?? "anecdotes:prototype";
  const runId = flag(argv, "--run-id") ?? "";
  const outPath = flag(argv, "--out");
  const writeNow = hasFlag(argv, "--write");

  const createContributor = hasFlag(argv, "--create-contributor");
  const contributorName = flag(argv, "--contributor-name");
  const contributorStatus =
    (flag(argv, "--contributor-status") as ContributorStatus | null) ??
    "historical";

  const text = readFileSync(responsePath, "utf-8");
  let candidates;
  try {
    candidates = parseCandidates(text);
  } catch (e) {
    die((e as Error).message);
  }
  console.log(`Parsed ${candidates.length} candidate(s)`);

  const allQuads: Quad[] = [];
  const when = nowIso();

  if (createContributor) {
    if (!contributorName) die("--create-contributor requires --contributor-name");
    const slug = contributorId.split("/").filter(Boolean).pop() ?? "unknown";
    const { quads } = buildContributorQuads({
      contributorSlug: slug,
      name: contributorName,
      status: contributorStatus,
      timestamp: when,
    });
    allQuads.push(...quads);
    console.log(`+ contributor: ${slug} (${contributorStatus})`);
  }

  for (const c of candidates) {
    try {
      const { id, quads } = buildAnecdoteQuads(c, {
        contributorId,
        scope,
        timestamp: when,
        extractionRunId: runId,
      });
      allQuads.push(...quads);
      console.log(`+ ${c.modality}: ${id}`);
    } catch (e) {
      console.error(`! failed: ${c.title}: ${(e as Error).message}`);
    }
  }

  console.log(`Total quads: ${allQuads.length}`);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(allQuads, null, 2));
    console.log(`Wrote quads to ${outPath}`);
  }

  if (writeNow) {
    const client = new CayleyClient();
    await client.waitReady(15);
    const written = await client.writeQuadsChunked(allQuads);
    console.log(`Wrote ${written} quads to Cayley at ${client.baseUrl}`);
  } else if (!outPath) {
    process.stdout.write(JSON.stringify(allQuads, null, 2) + "\n");
  }

  return 0;
}

// ── write ──────────────────────────────────────────────────────────────────

async function cmdWrite(argv: string[]): Promise<number> {
  const quadsPath = argv.find((a) => !a.startsWith("--"));
  if (!quadsPath) die("usage: write <quads-file.json>");
  if (!existsSync(quadsPath)) die(`quads file not found: ${quadsPath}`);
  const quads = JSON.parse(readFileSync(quadsPath, "utf-8")) as Quad[];
  if (!Array.isArray(quads)) die("quads file must be a JSON array");

  const client = new CayleyClient();
  await client.waitReady(15);
  const written = await client.writeQuadsChunked(quads);
  console.log(`Wrote ${written} quads to Cayley at ${client.baseUrl}`);
  return 0;
}

// ── query ──────────────────────────────────────────────────────────────────

type AnecdoteRecord = {
  id: string;
  title: string;
  modality: string;
  setup: string;
  complication: string;
  resolution: string;
  insight: string;
  insight_explicit: string;
  contributor: string;
  contributor_name: string;
  domains: string[];
  tags: string[];
  characters: string[];
  source_excerpt: string;
  utterances?: Array<{ ordinal: number; speaker: string; text: string }>;
};

async function cmdQuery(argv: string[]): Promise<number> {
  const byTag = flag(argv, "--by-tag");
  const byDomain = flag(argv, "--by-domain");
  const byModality = flag(argv, "--by-modality");
  const byContributor = flag(argv, "--by-contributor");
  const scope = flag(argv, "--scope") ?? "anecdotes:prototype";
  const limit = Number(flag(argv, "--limit") ?? 20);

  const client = new CayleyClient();
  await client.waitReady(15);

  // Resolve filter → list of anecdote IDs
  let ids: string[];
  if (byTag) {
    const tagId = `/anecdote/tag/${slugify(byTag)}`;
    ids = await getInIds(client, tagId, "/anecdote/edge/has_tag", limit);
  } else if (byDomain) {
    const domainId = `/anecdote/domain/${byDomain}`;
    ids = await getInIds(client, domainId, "/anecdote/edge/expertise_domain", limit);
  } else if (byModality) {
    const modalityId = `/anecdote/modality/${byModality}`;
    ids = await getInIds(client, modalityId, "/anecdote/edge/has_modality", limit);
  } else if (byContributor) {
    ids = await getInIds(client, byContributor, "/anecdote/edge/contributed_by", limit);
  } else {
    // default: by scope
    const scopeId = `/epistemology/scope/${scope.replace(/:/g, "_")}`;
    const all = await getInIds(client, scopeId, "/epistemology/edge/scoped_to", limit * 5);
    // filter to /anecdote/anecdote only
    ids = [];
    for (const candidate of all) {
      if (ids.length >= limit) break;
      const r = await client.queryGizmo(
        `g.V("${escapeNodeId(candidate)}").Out("/type/object/type").GetLimit(5)`,
      );
      const types = ((r.result as Array<{ id?: string }> | null) ?? [])
        .map((n) => n.id ?? "");
      if (types.includes("/anecdote/anecdote")) ids.push(candidate);
    }
  }

  const records: AnecdoteRecord[] = [];
  for (const id of ids) {
    try {
      records.push(await readAnecdote(client, id));
    } catch (e) {
      console.error(`! failed to read ${id}: ${(e as Error).message}`);
    }
  }

  process.stdout.write(JSON.stringify(records, null, 2) + "\n");
  return 0;
}

async function getInIds(
  client: CayleyClient,
  startNode: string,
  predicate: string,
  limit: number,
): Promise<string[]> {
  const script =
    `g.V("${escapeNodeId(startNode)}").In("${predicate}").GetLimit(${limit})`;
  const r = await client.queryGizmo(script);
  return ((r.result as Array<{ id?: string }> | null) ?? [])
    .filter((n) => n && n.id)
    .map((n) => n.id!);
}

async function scalarOut(
  client: CayleyClient,
  nodeId: string,
  predicate: string,
): Promise<string> {
  const r = await client.queryGizmo(
    `g.V("${escapeNodeId(nodeId)}").Out("${predicate}").GetLimit(1)`,
  );
  const items = ((r.result as Array<{ id?: string }> | null) ?? []);
  return items[0]?.id ?? "";
}

async function listOut(
  client: CayleyClient,
  nodeId: string,
  predicate: string,
): Promise<string[]> {
  const r = await client.queryGizmo(
    `g.V("${escapeNodeId(nodeId)}").Out("${predicate}").All()`,
  );
  return ((r.result as Array<{ id?: string }> | null) ?? [])
    .filter((n) => n && n.id)
    .map((n) => n.id!);
}

async function readAnecdote(
  client: CayleyClient,
  id: string,
): Promise<AnecdoteRecord> {
  const [
    title,
    setup,
    complication,
    resolution,
    insight,
    insightExplicit,
    sourceExcerpt,
    modalityNode,
    contributorId,
  ] = await Promise.all([
    scalarOut(client, id, "/type/object/name"),
    scalarOut(client, id, "/anecdote/anecdote/setup"),
    scalarOut(client, id, "/anecdote/anecdote/complication"),
    scalarOut(client, id, "/anecdote/anecdote/resolution"),
    scalarOut(client, id, "/anecdote/anecdote/insight"),
    scalarOut(client, id, "/anecdote/anecdote/insight_explicit"),
    scalarOut(client, id, "/anecdote/edge/source_text"),
    scalarOut(client, id, "/anecdote/edge/has_modality"),
    scalarOut(client, id, "/anecdote/edge/contributed_by"),
  ]);

  const [contributorName, domainIds, tagIds, characterIds] = await Promise.all([
    contributorId ? scalarOut(client, contributorId, "/anecdote/contributor/name") : "",
    listOut(client, id, "/anecdote/edge/expertise_domain"),
    listOut(client, id, "/anecdote/edge/has_tag"),
    listOut(client, id, "/anecdote/edge/mentions_character"),
  ]);

  const tagNames = await Promise.all(
    tagIds.map((t) => scalarOut(client, t, "/type/object/name")),
  );
  const characterNames = await Promise.all(
    characterIds.map((c) => scalarOut(client, c, "/type/object/name")),
  );

  // Utterances (dialectic only)
  let utterances: Array<{ ordinal: number; speaker: string; text: string }> | undefined;
  if (modalityNode === "/anecdote/modality/dialectic") {
    const uids = await listOut(client, id, "/anecdote/edge/has_utterance");
    const us = await Promise.all(
      uids.map(async (uid) => {
        const [speaker, ordinal, text] = await Promise.all([
          scalarOut(client, uid, "/anecdote/utterance/speaker"),
          scalarOut(client, uid, "/anecdote/utterance/ordinal"),
          scalarOut(client, uid, "/anecdote/utterance/text"),
        ]);
        return {
          speaker: stripLiteralQuotes(speaker),
          ordinal: Number(stripLiteralQuotes(ordinal)),
          text: stripLiteralQuotes(text),
        };
      }),
    );
    us.sort((a, b) => a.ordinal - b.ordinal);
    utterances = us;
  }

  return {
    id,
    title: stripLiteralQuotes(title),
    modality: modalityNode.split("/").pop() ?? "",
    setup: stripLiteralQuotes(setup),
    complication: stripLiteralQuotes(complication),
    resolution: stripLiteralQuotes(resolution),
    insight: stripLiteralQuotes(insight),
    insight_explicit: stripLiteralQuotes(insightExplicit),
    contributor: contributorId,
    contributor_name: stripLiteralQuotes(contributorName),
    domains: domainIds.map((d) => d.split("/").pop() ?? ""),
    tags: tagNames.map(stripLiteralQuotes),
    characters: characterNames.map(stripLiteralQuotes),
    source_excerpt: stripLiteralQuotes(sourceExcerpt),
    ...(utterances ? { utterances } : {}),
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── fetch-corpus ───────────────────────────────────────────────────────────

async function cmdFetchCorpus(argv: string[]): Promise<number> {
  const outRoot = flag(argv, "--out");
  if (!outRoot) die("usage: fetch-corpus --out <directory>");

  for (const src of CORPUS_SOURCES) {
    const dir = resolve(outRoot, src.slug, "raw");
    mkdirSync(dir, { recursive: true });
    const dest = resolve(dir, src.filename);
    if (existsSync(dest)) {
      console.log(`OK ${src.slug}: already present at ${dest}`);
      continue;
    }
    console.log(`Fetching ${src.slug} from ${src.url}`);
    const r = await fetch(src.url);
    if (!r.ok) {
      console.error(`! ${src.slug}: HTTP ${r.status}`);
      continue;
    }
    const text = await r.text();
    writeFileSync(dest, text);
    const size = text.length;
    console.log(`OK ${src.slug}: ${size.toLocaleString()} bytes → ${dest}`);
  }
  return 0;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printUsage();
    return cmd ? 0 : 1;
  }

  switch (cmd) {
    case "prompt":
      return cmdPrompt(rest);
    case "ingest":
      return await cmdIngest(rest);
    case "write":
      return await cmdWrite(rest);
    case "query":
      return await cmdQuery(rest);
    case "fetch-corpus":
      return await cmdFetchCorpus(rest);
    default:
      console.error(`Unknown subcommand: ${cmd}`);
      printUsage();
      return 1;
  }
}

function printUsage(): void {
  process.stderr.write(
    `Usage: AnecdotesCli.ts <subcommand> [options]

Subcommands:
  prompt <chunk-file> [--dialectic]
      Generate the LLM extraction prompt for a text chunk.

  ingest <response.json> --contributor <id> [--scope <scope>] [--run-id <id>]
                         [--out <quads.json>] [--write]
                         [--create-contributor --contributor-name <name>
                          --contributor-status active|withdrawn|historical]
      Parse + validate an LLM response, build Cayley quads.
      With --write, also POSTs to Cayley. With --out, writes quads JSON.

  write <quads.json>
      POST a pre-built quads JSON file to Cayley.

  query [--by-tag <tag>] [--by-domain <domain>] [--by-modality <modality>]
        [--by-contributor <id>] [--scope <scope>] [--limit <N>]
      Filtered retrieval. Default scope: anecdotes:prototype.

  fetch-corpus --out <directory>
      Download the Project Gutenberg prototype corpus (Franklin, Twain).

Environment:
  CAYLEY_BASE_URL   Cayley HTTP endpoint (default: http://localhost:64211)
`,
  );
}

if (import.meta.main) {
  process.exit(await main());
}
