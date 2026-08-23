#!/usr/bin/env bun
/**
 * StartLocal — boot a local Cayley instance against the pack's BoltDB store.
 *
 * Resolves the graph directory in this order:
 *   1. --graph-dir <path>
 *   2. $PAI_DIR/PAI/MEMORY/GRAPH
 *   3. $HOME/.claude/PAI/MEMORY/GRAPH
 *
 * If cayley.yml is missing in the graph dir, renders it from the pack's
 * Config/cayley.yml template.
 *
 * Cayley is spawned in the background; this script exits once Cayley is
 * reachable on the configured host:port (default 127.0.0.1:64210). To stop
 * the running Cayley, use: pkill -f 'cayley http'
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CayleyClient } from "./CayleyClient";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = resolve(__dirname, "..");

function defaultGraphDir(): string {
  if (process.env.PAI_DIR) return resolve(process.env.PAI_DIR, "PAI", "MEMORY", "GRAPH");
  return resolve(process.env.HOME ?? "", ".claude", "PAI", "MEMORY", "GRAPH");
}

function arg(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const graphDir = arg(argv, "--graph-dir") ?? defaultGraphDir();
  const host = arg(argv, "--host") ?? "127.0.0.1:64210";

  if (!existsSync(graphDir)) {
    mkdirSync(graphDir, { recursive: true });
    console.log(`Created graph directory: ${graphDir}`);
  }

  const renderedConfig = resolve(graphDir, "cayley.yml");
  if (!existsSync(renderedConfig)) {
    const template = readFileSync(resolve(PACK_DIR, "Config", "cayley.yml"), "utf-8");
    const rendered = template.replace(/__GRAPH_DIR__/g, graphDir);
    writeFileSync(renderedConfig, rendered);
    console.log(`Rendered cayley.yml at: ${renderedConfig}`);
  }

  const boltPath = resolve(graphDir, "mnemosyne.bolt");
  const initFlag = existsSync(boltPath) ? [] : ["--init"];

  const args = ["http", "--config", renderedConfig, "--host", host, ...initFlag];
  const logPath = resolve(graphDir, "cayley.log");
  appendFileSync(logPath, `\n--- started ${new Date().toISOString()} ---\n`);
  const logFd = openSync(logPath, "a");

  console.log(`Spawning: cayley ${args.join(" ")}`);
  const child = spawn("cayley", args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();

  // Wait for ready
  const url = `http://${host}`;
  const client = new CayleyClient(url);
  try {
    await client.waitReady(60);
    console.log(`Cayley ready at ${url} (logs: ${logPath})`);
  } catch (e) {
    console.error(`Cayley did not become ready: ${(e as Error).message}`);
    console.error(`Check ${logPath} for details.`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
