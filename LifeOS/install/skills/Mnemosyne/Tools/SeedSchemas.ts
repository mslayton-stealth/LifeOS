#!/usr/bin/env bun
/**
 * SeedSchemas — parse the substrate .nq schemas and write them to a running Cayley.
 *
 * Usage:
 *   bun SeedSchemas.ts [--base-url http://localhost:64210] [--dry-run] [--skip-wait]
 *
 * Seeds in dependency order: epistemology → classifiers → scopes.
 * Idempotent — Cayley's load.ignore_duplicates suppresses re-writes.
 *
 * Ported from src/seed/seed_all.py + src/seed/nq_parser.py.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CayleyClient, CayleyError, type Quad } from "./CayleyClient";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(__dirname, "..", "Schemas");

const SEED_ORDER: Array<[string, string]> = [
  ["epistemology", resolve(SCHEMAS_DIR, "epistemology.nq")],
  ["classifiers", resolve(SCHEMAS_DIR, "classifiers.nq")],
  ["scopes", resolve(SCHEMAS_DIR, "scopes.nq")],
];

const ANCHOR_NODES: Array<[string, string]> = [
  ["/epistemology/epistemic_state", "EpistemicState type node"],
  ["/epistemology/verified", "verified EpistemicState value"],
  ["/epistemology/putative", "putative EpistemicState value"],
  ["/epistemology/edge/has_state", "has_state edge type"],
  ["/epistemology/edge/written_at", "written_at edge type"],
  ["/classifier/entity", "Entity classifier root"],
  ["/classifier/assertion/observation", "Observation assertion classifier"],
  ["/classifier/process/emergent", "EmergentProcess classifier"],
  ["/epistemology/scope/physical_reality", "physical_reality scope"],
  ["/epistemology/scope/pai_memory", "pai:memory scope"],
];

// ── NQuad parser ───────────────────────────────────────────────────────────

/**
 * Parse a single NQuad line into a Quad. Supports:
 *   <subject> <predicate> <object> .
 *   <subject> <predicate> "literal" .
 *   <subject> <predicate> "literal"^^<datatype> .
 *
 * Comments (starting with #) and blank lines are skipped.
 */
function parseLine(line: string): Quad | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  // Strip trailing dot
  let body = trimmed.replace(/\s*\.\s*$/, "");

  // Subject: <iri>
  const subjMatch = body.match(/^<([^>]+)>\s+/);
  if (!subjMatch) return null;
  const subject = subjMatch[1];
  body = body.slice(subjMatch[0].length);

  // Predicate: <iri>
  const predMatch = body.match(/^<([^>]+)>\s+/);
  if (!predMatch) return null;
  const predicate = predMatch[1];
  body = body.slice(predMatch[0].length);

  // Object: either <iri> or "literal" (with optional ^^<datatype>)
  body = body.trim();
  if (body.startsWith("<")) {
    const objMatch = body.match(/^<([^>]+)>/);
    if (!objMatch) return null;
    return { subject, predicate, object: objMatch[1] };
  } else if (body.startsWith('"')) {
    // Literal: keep the surrounding quotes — Cayley expects the literal form
    // including quotes for string values.
    const endQuote = body.indexOf('"', 1);
    if (endQuote === -1) return null;
    const literal = body.slice(0, endQuote + 1);
    return { subject, predicate, object: literal };
  }
  return null;
}

export function parseNqFile(path: string): Quad[] {
  const content = readFileSync(path, "utf-8");
  if (content.includes("\r")) {
    throw new Error(
      `CRLF detected in ${path} — Cayley requires Unix LF only. Run: dos2unix ${path}`,
    );
  }
  const quads: Quad[] = [];
  for (const line of content.split("\n")) {
    const q = parseLine(line);
    if (q) quads.push(q);
  }
  return quads;
}

// ── Seed driver ────────────────────────────────────────────────────────────

async function seedSchema(
  client: CayleyClient,
  name: string,
  path: string,
  dryRun: boolean,
): Promise<number> {
  console.log(`Parsing /${name} schema from ${path}`);
  const quads = parseNqFile(path);
  console.log(`  ${quads.length} quads parsed`);

  if (dryRun) {
    console.log(`  [dry-run] would write ${quads.length} quads`);
    return quads.length;
  }

  const written = await client.writeQuadsChunked(quads);
  console.log(`  wrote ${written} quads`);
  return written;
}

async function verify(client: CayleyClient): Promise<boolean> {
  let allOk = true;
  console.log("Verifying anchor nodes …");
  for (const [nodeId, label] of ANCHOR_NODES) {
    const exists = await client.nodeExists(nodeId);
    const mark = exists ? "OK" : "MISSING";
    console.log(`  ${mark} ${label} (${nodeId})`);
    if (!exists) allOk = false;
  }
  return allOk;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const baseUrl = argFlag(argv, "--base-url") ?? undefined;
  const dryRun = argv.includes("--dry-run");
  const skipWait = argv.includes("--skip-wait");

  const client = new CayleyClient(baseUrl);
  console.log(`Targeting Cayley at: ${client.baseUrl}`);

  if (!dryRun && !skipWait) {
    console.log("Waiting for Cayley to be ready …");
    try {
      await client.waitReady(60);
    } catch (e) {
      console.error((e as CayleyError).message);
      return 1;
    }
  }

  let total = 0;
  for (const [name, path] of SEED_ORDER) {
    if (!existsSync(path)) {
      console.error(`Schema file not found: ${path}`);
      return 1;
    }
    try {
      total += await seedSchema(client, name, path, dryRun);
    } catch (e) {
      console.error(`Failed seeding /${name}: ${(e as Error).message}`);
      return 1;
    }
  }
  console.log(`Total quads processed: ${total}`);

  if (!dryRun) {
    const ok = await verify(client);
    if (!ok) {
      console.error("Verification failed — some anchor nodes not found");
      return 1;
    }
    console.log("All verification checks passed");
  }
  console.log("Seed complete.");
  return 0;
}

function argFlag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}

if (import.meta.main) {
  process.exit(await main());
}
