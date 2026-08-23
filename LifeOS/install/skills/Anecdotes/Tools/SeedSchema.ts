#!/usr/bin/env bun
/**
 * SeedSchema — parse the anecdotes.nq schema and write it to a running Cayley.
 *
 * Assumes the Mnemosyne pack's substrate schemas (epistemology, classifiers, scopes)
 * are already seeded. The anecdotes.nq depends on /epistemology/context_scope.
 *
 * Usage:
 *   bun SeedSchema.ts [--base-url http://localhost:64211] [--dry-run] [--skip-wait]
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CayleyClient, CayleyError, type Quad } from "./CayleyClient";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "..", "Schemas", "anecdotes.nq");

const ANCHOR_NODES: Array<[string, string]> = [
  ["/anecdote/anecdote", "Anecdote type"],
  ["/anecdote/anecdote/setup", "setup property"],
  ["/anecdote/anecdote/insight", "insight property"],
  ["/anecdote/modality/dictated", "dictated modality"],
  ["/anecdote/modality/reflective", "reflective modality"],
  ["/anecdote/modality/curated", "curated modality"],
  ["/anecdote/modality/dialectic", "dialectic modality"],
  ["/anecdote/modality/interview", "interview modality"],
  ["/anecdote/utterance", "Utterance type"],
  ["/anecdote/contributor", "Contributor type"],
  ["/anecdote/contributor_status/active", "active contributor status"],
  ["/anecdote/contributor_status/historical", "historical contributor status"],
  ["/anecdote/domain/talent_agent", "talent_agent domain"],
  ["/anecdote/domain/journalism", "journalism domain"],
  ["/anecdote/edge/contributed_by", "contributed_by edge"],
  ["/anecdote/edge/has_modality", "has_modality edge"],
  ["/anecdote/edge/has_utterance", "has_utterance edge"],
  ["/epistemology/scope/anecdotes_prototype", "anecdotes:prototype scope"],
];

function parseLine(line: string): Quad | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  let body = trimmed.replace(/\s*\.\s*$/, "");

  const subjMatch = body.match(/^<([^>]+)>\s+/);
  if (!subjMatch) return null;
  const subject = subjMatch[1];
  body = body.slice(subjMatch[0].length);

  const predMatch = body.match(/^<([^>]+)>\s+/);
  if (!predMatch) return null;
  const predicate = predMatch[1];
  body = body.slice(predMatch[0].length);

  body = body.trim();
  if (body.startsWith("<")) {
    const objMatch = body.match(/^<([^>]+)>/);
    if (!objMatch) return null;
    return { subject, predicate, object: objMatch[1] };
  } else if (body.startsWith('"')) {
    const endQuote = body.indexOf('"', 1);
    if (endQuote === -1) return null;
    return { subject, predicate, object: body.slice(0, endQuote + 1) };
  }
  return null;
}

function parseNqFile(path: string): Quad[] {
  const content = readFileSync(path, "utf-8");
  if (content.includes("\r")) {
    throw new Error(`CRLF detected in ${path} — Cayley requires Unix LF only.`);
  }
  const quads: Quad[] = [];
  for (const line of content.split("\n")) {
    const q = parseLine(line);
    if (q) quads.push(q);
  }
  return quads;
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

function argFlag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const baseUrl = argFlag(argv, "--base-url") ?? undefined;
  const dryRun = argv.includes("--dry-run");
  const skipWait = argv.includes("--skip-wait");

  const client = new CayleyClient(baseUrl);
  console.log(`Targeting Cayley at: ${client.baseUrl}`);

  if (!existsSync(SCHEMA_PATH)) {
    console.error(`Schema file not found: ${SCHEMA_PATH}`);
    return 1;
  }

  if (!dryRun && !skipWait) {
    console.log("Waiting for Cayley to be ready …");
    try {
      await client.waitReady(30);
    } catch (e) {
      console.error((e as CayleyError).message);
      return 1;
    }
  }

  // Pre-check Mnemosyne substrate
  const substrateOk = await client.nodeExists("/epistemology/context_scope");
  if (!substrateOk) {
    console.error(
      "Mnemosyne substrate not detected. Run: bun ~/.claude/skills/Mnemosyne/Tools/SeedSchemas.ts",
    );
    return 1;
  }

  console.log(`Parsing /anecdote schema from ${SCHEMA_PATH}`);
  const quads = parseNqFile(SCHEMA_PATH);
  console.log(`  ${quads.length} quads parsed`);

  if (dryRun) {
    console.log(`  [dry-run] would write ${quads.length} quads`);
  } else {
    const written = await client.writeQuadsChunked(quads);
    console.log(`  wrote ${written} quads`);
  }

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

if (import.meta.main) {
  process.exit(await main());
}
