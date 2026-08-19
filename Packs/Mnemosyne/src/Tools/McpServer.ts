#!/usr/bin/env bun
/**
 * Mnemosyne MCP server (stdio transport).
 *
 * Exposes 13 tools to Claude Code:
 *   query, node, assert_node, assert_edge — graph CRUD
 *   recent_activity                         — catch-up primitive
 *   list_by_state, list_by_scope            — epistemic slicing
 *   task_create, task_update, task_query,
 *   task_list, task_ready                   — coordination
 *
 * Plus a mnemosyne://node/{id} resource template for direct node addressing.
 *
 * Cayley endpoint: CAYLEY_BASE_URL env var, default http://localhost:64210.
 *
 * Ported from src/query_host/* in the upstream mnemosyne stack.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { CayleyClient, escapeNodeId, stripLiteralQuotes, type Quad } from "./CayleyClient";
import { EPISTEMIC_RANKS, getNode, insideOutQuery, isStructural } from "./InsideOut";

const WRITTEN_AT_PREDICATE = "/epistemology/edge/written_at";
const NO_SCOPE = new Set(["", "any", "all", "none"]);

const INSTRUCTIONS = `Mnemosyne is a persistent, associative knowledge graph. Use the tools below to query and extend it.

Primary pattern — query (inside-out):
  Start from any node. The query scales outward to the surrounding cluster,
  prunes by scope and epistemic certainty, then returns the surviving subgraph.
  Self-similar: this pattern works identically at any abstraction level.

Catch-up pattern — recent_activity:
  When a session resumes or an agent is spawned, call recent_activity(since)
  with the timestamp of last contact to discover what nodes have been written
  or updated. This replaces re-explanation. Every write through assert_node,
  assert_edge, task_create, and task_update timestamps the affected nodes.

Epistemic states (partial order, most → least certain):
  verified > putative ≈ emergent > speculative > contested > debunked|fictional

ContextScopes:
  physical_reality, pai:memory, pai:knowledge, pai:work, pai:learning, pai:project

Classifier types (self-similar taxonomy):
  /classifier/entity/*       — things that exist
  /classifier/process/*      — things that happen
  /classifier/assertion/*    — claims about the world
  /classifier/relationship/* — how things connect
`;

function client(): CayleyClient {
  return new CayleyClient(
    process.env.CAYLEY_BASE_URL ?? "http://localhost:64210",
  );
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function withWrittenAt(quads: Quad[], subjects: string[], when?: string): Quad[] {
  const ts = when ?? nowIso();
  const seen = new Set<string>();
  const tsQuads: Quad[] = [];
  for (const s of subjects) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    tsQuads.push({
      subject: s,
      predicate: WRITTEN_AT_PREDICATE,
      object: `"${ts}"`,
    });
  }
  return [...quads, ...tsQuads];
}

function ok<T>(payload: T): string {
  return JSON.stringify(payload, null, 2);
}

function err(message: string): string {
  return JSON.stringify({ error: message });
}

// ── Tool implementations ────────────────────────────────────────────────────

async function toolQuery(args: Record<string, unknown>): Promise<string> {
  const start_node = String(args.start_node ?? "");
  if (!start_node) return err("start_node is required");
  const scopeIn = args.scope == null ? null : String(args.scope);
  const scope = scopeIn && !NO_SCOPE.has(scopeIn) ? scopeIn : null;
  const epistemic_floor = String(args.epistemic_floor ?? "speculative");
  const depth = Math.max(1, Math.min(Number(args.depth ?? 2) | 0, 4));
  const max_nodes = Number(args.max_nodes ?? 50) | 0;
  const result = await insideOutQuery(client(), {
    start_node,
    scope,
    epistemic_floor,
    depth,
    max_nodes,
  });
  return ok(result);
}

async function toolNode(args: Record<string, unknown>): Promise<string> {
  const node_id = String(args.node_id ?? "");
  if (!node_id) return err("node_id is required");
  const ann = await getNode(client(), node_id);
  return ok(ann);
}

async function toolAssertNode(args: Record<string, unknown>): Promise<string> {
  const node_id = String(args.node_id ?? "");
  const name = String(args.name ?? "");
  const description = String(args.description ?? "");
  const node_type = String(args.node_type ?? "");
  const epistemic_state = String(args.epistemic_state ?? "");
  const scope = String(args.scope ?? "");
  const justification = String(args.justification ?? "empirical");
  const provenance = String(args.provenance ?? "");

  if (!node_id) return err("node_id is required");
  if (!(epistemic_state in EPISTEMIC_RANKS)) {
    return err(
      `Unknown epistemic_state '${epistemic_state}'. Valid: ${Object.keys(EPISTEMIC_RANKS).sort().join(", ")}`,
    );
  }

  const state_node = `/epistemology/${epistemic_state}`;
  const scope_node = `/epistemology/scope/${scope}`;
  const justification_node =
    justification === "emergent"
      ? "/epistemology/emergent_justification"
      : `/epistemology/${justification}`;

  let quads: Quad[] = [
    { subject: node_id, predicate: "/type/object/type", object: node_type },
    { subject: node_id, predicate: "/type/object/name", object: `"${name}"` },
    {
      subject: node_id,
      predicate: "/common/topic/description",
      object: `"${description}"`,
    },
    {
      subject: node_id,
      predicate: "/epistemology/edge/has_state",
      object: state_node,
    },
    {
      subject: node_id,
      predicate: "/epistemology/edge/scoped_to",
      object: scope_node,
    },
    {
      subject: node_id,
      predicate: "/epistemology/edge/justification_type",
      object: justification_node,
    },
  ];
  if (provenance) {
    quads.push({
      subject: node_id,
      predicate: "/epistemology/edge/provenance",
      object: `"${provenance}"`,
    });
  }

  quads = withWrittenAt(quads, [node_id]);

  try {
    await client().writeQuads(quads);
  } catch (e) {
    return err((e as Error).message);
  }

  return ok({
    ok: true,
    node_id,
    epistemic_state,
    scope,
    quads_written: quads.length,
  });
}

async function toolAssertEdge(args: Record<string, unknown>): Promise<string> {
  const subject_id = String(args.subject_id ?? "");
  const predicate = String(args.predicate ?? "");
  const object_id = String(args.object_id ?? "");
  const direction = String(args.direction ?? "forward");
  const weight = Math.max(0, Math.min(1, Number(args.weight ?? 1)));
  const epistemic_state = String(args.epistemic_state ?? "putative");
  const scope = String(args.scope ?? "physical_reality");
  const provenance = String(args.provenance ?? "");

  if (!subject_id || !predicate || !object_id) {
    return err("subject_id, predicate, and object_id are required");
  }
  if (!["forward", "reverse", "bidirectional"].includes(direction)) {
    return err(`Invalid direction '${direction}'. Use forward|reverse|bidirectional`);
  }
  if (!(epistemic_state in EPISTEMIC_RANKS)) {
    return err(`Unknown epistemic_state '${epistemic_state}'`);
  }

  const hash = createHash("sha1")
    .update(`${subject_id}|${predicate}|${object_id}`)
    .digest("hex")
    .slice(0, 12);
  const instance_id = `/edge/instance/${hash}`;

  const state_node = `/epistemology/${epistemic_state}`;
  const scope_node = `/epistemology/scope/${scope}`;
  const direction_node = `/epistemology/edge_direction/${direction}`;

  const quads: Quad[] = [];

  if (direction === "forward" || direction === "bidirectional") {
    quads.push({ subject: subject_id, predicate, object: object_id });
  }
  if (direction === "reverse" || direction === "bidirectional") {
    quads.push({ subject: object_id, predicate, object: subject_id });
  }

  quads.push(
    {
      subject: instance_id,
      predicate: "/type/object/type",
      object: "/epistemology/edge_instance",
    },
    {
      subject: instance_id,
      predicate: "/epistemology/edge_instance/subject",
      object: subject_id,
    },
    {
      subject: instance_id,
      predicate: "/epistemology/edge_instance/predicate",
      object: predicate,
    },
    {
      subject: instance_id,
      predicate: "/epistemology/edge_instance/object",
      object: object_id,
    },
    {
      subject: instance_id,
      predicate: "/epistemology/edge_instance/weight",
      object: `"${weight}"`,
    },
    {
      subject: instance_id,
      predicate: "/epistemology/edge_instance/direction",
      object: direction_node,
    },
    {
      subject: instance_id,
      predicate: "/epistemology/edge/has_state",
      object: state_node,
    },
    {
      subject: instance_id,
      predicate: "/epistemology/edge/scoped_to",
      object: scope_node,
    },
  );
  if (provenance) {
    quads.push({
      subject: instance_id,
      predicate: "/epistemology/edge/provenance",
      object: `"${provenance}"`,
    });
  }

  const stamped = withWrittenAt(quads, [instance_id, subject_id, object_id]);

  try {
    await client().writeQuads(stamped);
  } catch (e) {
    return err((e as Error).message);
  }

  return ok({
    ok: true,
    instance_id,
    subject_id,
    predicate,
    object_id,
    direction,
    weight,
    epistemic_state,
    quads_written: stamped.length,
  });
}

async function toolRecentActivity(args: Record<string, unknown>): Promise<string> {
  const since = String(args.since ?? "");
  if (!since) return err("since is required (ISO-8601 UTC, e.g. '2026-05-25T00:00:00Z')");
  const scopeIn = args.scope == null ? null : String(args.scope);
  const scope = scopeIn && !NO_SCOPE.has(scopeIn.toLowerCase()) ? scopeIn : null;
  const limit = Math.max(1, Math.min(Number(args.limit ?? 50) | 0, 500));

  const c = client();

  const subjectsScript =
    `g.V().Out("${WRITTEN_AT_PREDICATE}")` +
    `.In("${WRITTEN_AT_PREDICATE}").Unique().GetLimit(2000)`;
  const subjResult = await c.queryGizmo(subjectsScript);
  const subjects = ((subjResult.result as Array<{ id?: string }> | null) ?? [])
    .filter((n) => n && n.id)
    .map((n) => n.id!);

  type Entry = { node_id: string; written_at: string };
  const activity: Entry[] = [];
  for (const sub of subjects) {
    const tsResult = await c.queryGizmo(
      `g.V("${escapeNodeId(sub)}").Out("${WRITTEN_AT_PREDICATE}").All()`,
    );
    const timestamps = ((tsResult.result as Array<{ id?: string }> | null) ?? [])
      .filter((n) => n && n.id)
      .map((n) => stripLiteralQuotes(n.id!));
    if (timestamps.length === 0) continue;
    const maxTs = timestamps.reduce((a, b) => (a > b ? a : b));
    if (maxTs > since) activity.push({ node_id: sub, written_at: maxTs });
  }

  let filtered = activity;
  if (scope) {
    const scopeNode = `/epistemology/scope/${scope}`;
    const sr = await c.queryGizmo(
      `g.V("${escapeNodeId(scopeNode)}").In("/epistemology/edge/scoped_to").GetLimit(2000)`,
    );
    const scopedIds = new Set(
      ((sr.result as Array<{ id?: string }> | null) ?? [])
        .filter((n) => n && n.id)
        .map((n) => n.id!),
    );
    filtered = activity.filter((a) => scopedIds.has(a.node_id));
  }

  filtered.sort((a, b) => (a.written_at < b.written_at ? 1 : -1));
  filtered = filtered.slice(0, limit);

  return ok({ since, scope, count: filtered.length, activity: filtered });
}

async function toolListByState(args: Record<string, unknown>): Promise<string> {
  const epistemic_state = String(args.epistemic_state ?? "");
  if (!(epistemic_state in EPISTEMIC_RANKS)) {
    return err(`Unknown state '${epistemic_state}'`);
  }
  const limit = Number(args.limit ?? 50) | 0;
  const stateNode = `/epistemology/${epistemic_state}`;
  const r = await client().queryGizmo(
    `g.V("${escapeNodeId(stateNode)}").In("/epistemology/edge/has_state").GetLimit(${limit})`,
  );
  const nodes = ((r.result as Array<{ id?: string }> | null) ?? [])
    .filter((n) => n && n.id && !isStructural(n.id!))
    .map((n) => n.id!);
  return ok({ epistemic_state, node_count: nodes.length, nodes });
}

async function toolListByScope(args: Record<string, unknown>): Promise<string> {
  const scope = String(args.scope ?? "");
  if (!scope) return err("scope is required");
  const limit = Number(args.limit ?? 50) | 0;
  const scopeNode = `/epistemology/scope/${scope}`;
  const r = await client().queryGizmo(
    `g.V("${escapeNodeId(scopeNode)}").In("/epistemology/edge/scoped_to").GetLimit(${limit})`,
  );
  const nodes = ((r.result as Array<{ id?: string }> | null) ?? [])
    .filter((n) => n && n.id && !isStructural(n.id!))
    .map((n) => n.id!);
  return ok({ scope, node_count: nodes.length, nodes });
}

function taskId(name: string, scope: string): string {
  const hash = createHash("sha1")
    .update(`${scope}|${name}`)
    .digest("hex")
    .slice(0, 10);
  const slug = name.replace(/\s+/g, "_").toLowerCase();
  return `/coordination/task/${scope}/${slug}_${hash}`;
}

async function toolTaskCreate(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? "");
  const description = String(args.description ?? "");
  const scope = String(args.scope ?? "default");
  const depends_on = Array.isArray(args.depends_on) ? (args.depends_on as string[]) : [];
  const interface_nodes = Array.isArray(args.interface_nodes)
    ? (args.interface_nodes as string[])
    : [];
  if (!name) return err("name is required");

  const tid = taskId(name, scope);
  let quads: Quad[] = [
    {
      subject: tid,
      predicate: "/type/object/type",
      object: "/coordination/task",
    },
    { subject: tid, predicate: "/type/object/name", object: `"${name}"` },
    {
      subject: tid,
      predicate: "/common/topic/description",
      object: `"${description}"`,
    },
    {
      subject: tid,
      predicate: "/epistemology/edge/has_state",
      object: "/epistemology/speculative",
    },
    {
      subject: tid,
      predicate: "/epistemology/edge/scoped_to",
      object: `/coordination/scope/${scope}`,
    },
  ];
  for (const dep of depends_on) {
    quads.push({
      subject: tid,
      predicate: "/epistemology/edge/derives_from",
      object: dep,
    });
  }
  for (const iface of interface_nodes) {
    quads.push({
      subject: tid,
      predicate: "/coordination/edge/interface",
      object: iface,
    });
  }
  quads = withWrittenAt(quads, [tid]);

  try {
    await client().writeQuads(quads);
  } catch (e) {
    return err((e as Error).message);
  }
  return ok({
    ok: true,
    task_id: tid,
    state: "speculative",
    depends_on_count: depends_on.length,
    interface_count: interface_nodes.length,
  });
}

async function toolTaskUpdate(args: Record<string, unknown>): Promise<string> {
  const task_id = String(args.task_id ?? "");
  const state = String(args.state ?? "");
  const output_node_id = String(args.output_node_id ?? "");
  const notes = String(args.notes ?? "");
  if (!task_id) return err("task_id is required");
  if (!(state in EPISTEMIC_RANKS)) return err(`Invalid state '${state}'`);

  let quads: Quad[] = [
    {
      subject: task_id,
      predicate: "/epistemology/edge/has_state",
      object: `/epistemology/${state}`,
    },
  ];
  if (output_node_id) {
    quads.push({
      subject: task_id,
      predicate: "/coordination/edge/produced_output",
      object: output_node_id,
    });
  }
  if (notes) {
    const truncated = notes.replace(/"/g, "'").slice(0, 500);
    quads.push({
      subject: task_id,
      predicate: "/coordination/edge/agent_notes",
      object: `"${truncated}"`,
    });
  }
  quads = withWrittenAt(quads, [task_id]);

  try {
    await client().writeQuads(quads);
  } catch (e) {
    return err((e as Error).message);
  }
  return ok({ ok: true, task_id, state });
}

async function toolTaskQuery(args: Record<string, unknown>): Promise<string> {
  const task_id = String(args.task_id ?? "");
  if (!task_id) return err("task_id is required");
  const c = client();
  const esc = escapeNodeId(task_id);

  async function scalar(predicate: string): Promise<string> {
    const r = await c.queryGizmo(`g.V("${esc}").Out("${predicate}").GetLimit(1)`);
    const items = ((r.result as Array<{ id?: string }> | null) ?? []);
    return items[0]?.id ?? "";
  }
  async function list(nodeId: string, predicate: string): Promise<string[]> {
    const r = await c.queryGizmo(
      `g.V("${escapeNodeId(nodeId)}").Out("${predicate}").All()`,
    );
    return ((r.result as Array<{ id?: string }> | null) ?? [])
      .filter((n) => n && n.id)
      .map((n) => n.id!);
  }

  const name = stripLiteralQuotes(await scalar("/type/object/name"));
  const description = stripLiteralQuotes(await scalar("/common/topic/description"));
  const stateNode = await scalar("/epistemology/edge/has_state");
  const state = stateNode ? (stateNode.split("/").pop() ?? "unknown") : "unknown";
  const depends_on = await list(task_id, "/epistemology/edge/derives_from");
  const interface_nodes = await list(task_id, "/coordination/edge/interface");
  const output_nodes = await list(task_id, "/coordination/edge/produced_output");

  const dep_states: Array<{ task_id: string; state: string }> = [];
  for (const dep of depends_on) {
    const r = await c.queryGizmo(
      `g.V("${escapeNodeId(dep)}").Out("/epistemology/edge/has_state").GetLimit(1)`,
    );
    const items = ((r.result as Array<{ id?: string }> | null) ?? []);
    const depState = items[0]?.id ? (items[0].id.split("/").pop() ?? "unknown") : "unknown";
    dep_states.push({ task_id: dep, state: depState });
  }
  const dispatchable = dep_states.every((d) => d.state === "verified");

  return ok({
    task_id,
    name,
    description,
    state,
    depends_on: dep_states,
    interface_nodes,
    output_nodes,
    dispatchable,
  });
}

async function toolTaskList(args: Record<string, unknown>): Promise<string> {
  const state = String(args.state ?? "");
  const scope = String(args.scope ?? "");
  let script: string;
  if (state && scope) {
    script =
      `g.V("/coordination/scope/${scope}").In("/epistemology/edge/scoped_to")` +
      `.Has("/epistemology/edge/has_state", "/epistemology/${state}")` +
      `.GetLimit(100)`;
  } else if (state) {
    script =
      `g.V("/epistemology/${state}").In("/epistemology/edge/has_state")` +
      `.Has("/type/object/type", "/coordination/task").GetLimit(100)`;
  } else if (scope) {
    script =
      `g.V("/coordination/scope/${scope}").In("/epistemology/edge/scoped_to")` +
      `.Has("/type/object/type", "/coordination/task").GetLimit(100)`;
  } else {
    script = `g.V("/coordination/task").In("/type/object/type").GetLimit(100)`;
  }
  const r = await client().queryGizmo(script);
  const task_ids = ((r.result as Array<{ id?: string }> | null) ?? [])
    .filter((n) => n && n.id)
    .map((n) => n.id!);
  return ok({ filter: { state, scope }, count: task_ids.length, task_ids });
}

async function toolTaskReady(args: Record<string, unknown>): Promise<string> {
  const scope = String(args.scope ?? "default");
  const c = client();
  const script =
    `g.V("/coordination/scope/${scope}").In("/epistemology/edge/scoped_to")` +
    `.Has("/epistemology/edge/has_state", "/epistemology/speculative")` +
    `.GetLimit(100)`;
  const r = await c.queryGizmo(script);
  const candidates = ((r.result as Array<{ id?: string }> | null) ?? [])
    .filter((n) => n && n.id)
    .map((n) => n.id!);

  const ready: string[] = [];
  for (const tid of candidates) {
    const depR = await c.queryGizmo(
      `g.V("${escapeNodeId(tid)}").Out("/epistemology/edge/derives_from").All()`,
    );
    const deps = ((depR.result as Array<{ id?: string }> | null) ?? [])
      .filter((n) => n && n.id)
      .map((n) => n.id!);
    let allDone = true;
    for (const dep of deps) {
      const ds = await c.queryGizmo(
        `g.V("${escapeNodeId(dep)}").Out("/epistemology/edge/has_state").GetLimit(1)`,
      );
      const items = ((ds.result as Array<{ id?: string }> | null) ?? []);
      if (!items[0]?.id?.includes("/epistemology/verified")) {
        allDone = false;
        break;
      }
    }
    if (allDone) ready.push(tid);
  }

  return ok({ scope, ready_count: ready.length, task_ids: ready });
}

// ── Tool registry ──────────────────────────────────────────────────────────

type ToolImpl = (args: Record<string, unknown>) => Promise<string>;

const TOOLS: Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolImpl;
}> = [
  {
    name: "query",
    description:
      "Inside-out graph query — the primary Mnemosyne pattern. Start from any node, scale outward to its surrounding cluster, prune by scope and epistemic certainty, return the surviving subgraph. Self-similar at any abstraction level.",
    inputSchema: {
      type: "object",
      properties: {
        start_node: { type: "string", description: "Cayley node ID, e.g. '/pai/knowledge/ideas/agentic-core-loop'" },
        scope: { type: "string", description: "ContextScope name to restrict results, e.g. 'pai:knowledge'. Omit or pass 'any' for no scope filter." },
        epistemic_floor: { type: "string", description: "Minimum epistemic state to include: verified|putative|emergent|speculative|contested|debunked|fictional. Default 'speculative' excludes contested/debunked/fictional." },
        depth: { type: "integer", description: "Traversal depth (1–4). Default 2." },
        max_nodes: { type: "integer", description: "Maximum nodes to return. Default 50." },
      },
      required: ["start_node"],
    },
    handler: toolQuery,
  },
  {
    name: "node",
    description: "Fetch a single node's full epistemic envelope (id, name, description, types, epistemic_state, state_rank, scopes).",
    inputSchema: {
      type: "object",
      properties: { node_id: { type: "string", description: "Cayley node ID to fetch" } },
      required: ["node_id"],
    },
    handler: toolNode,
  },
  {
    name: "assert_node",
    description: "Write a new node with required epistemic metadata: type, name, description, state, scope, justification, optional provenance.",
    inputSchema: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "New node ID, e.g. '/pai/observation/bun-faster-than-npm'" },
        name: { type: "string" },
        description: { type: "string" },
        node_type: { type: "string", description: "Classifier type, e.g. '/classifier/assertion/observation' or '/classifier/entity/agent'" },
        epistemic_state: { type: "string", description: "verified|putative|emergent|speculative|contested|debunked|fictional" },
        scope: { type: "string", description: "ContextScope name, e.g. 'pai:memory' or 'physical_reality'" },
        justification: { type: "string", description: "empirical|inferential|testimonial|intuitive|emergent. Default 'empirical'." },
        provenance: { type: "string", description: "Source reference (free text)" },
      },
      required: ["node_id", "name", "description", "node_type", "epistemic_state", "scope"],
    },
    handler: toolAssertNode,
  },
  {
    name: "assert_edge",
    description: "Write a weighted, directional edge between two existing nodes. Reified via CVT — the EdgeInstance node carries weight, direction, epistemic state, scope, provenance. Idempotent via deterministic SHA1 instance ID.",
    inputSchema: {
      type: "object",
      properties: {
        subject_id: { type: "string" },
        predicate: { type: "string", description: "Edge predicate, e.g. '/epistemology/edge/supports', '/epistemology/edge/contradicts', '/epistemology/edge/derives_from', '/classifier/relationship/causal'" },
        object_id: { type: "string" },
        direction: { type: "string", description: "forward|reverse|bidirectional. Default forward." },
        weight: { type: "number", description: "Confidence 0.0–1.0. Default 1.0." },
        epistemic_state: { type: "string", description: "Default putative." },
        scope: { type: "string", description: "Default physical_reality." },
        provenance: { type: "string" },
      },
      required: ["subject_id", "predicate", "object_id"],
    },
    handler: toolAssertEdge,
  },
  {
    name: "recent_activity",
    description: "List graph nodes written or updated after `since`, most-recent first. The catch-up primitive: spawned agents and resumed sessions call this to discover changes since last contact.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO-8601 UTC timestamp ('YYYY-MM-DDTHH:MM:SSZ'). Returns nodes written strictly AFTER this moment." },
        scope: { type: "string", description: "ContextScope filter. Omit or pass 'any' for no filter." },
        limit: { type: "integer", description: "Maximum nodes to return. Default 50, max 500." },
      },
      required: ["since"],
    },
    handler: toolRecentActivity,
  },
  {
    name: "list_by_state",
    description: "List all nodes carrying a specific epistemic state.",
    inputSchema: {
      type: "object",
      properties: {
        epistemic_state: { type: "string", description: "verified|putative|emergent|speculative|contested|debunked|fictional" },
        limit: { type: "integer", description: "Default 50." },
      },
      required: ["epistemic_state"],
    },
    handler: toolListByState,
  },
  {
    name: "list_by_scope",
    description: "List all nodes scoped to a given ContextScope.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "ContextScope name, e.g. 'pai:knowledge', 'physical_reality'" },
        limit: { type: "integer", description: "Default 50." },
      },
      required: ["scope"],
    },
    handler: toolListByScope,
  },
  {
    name: "task_create",
    description: "Create a coordination task in the graph. Starts in 'speculative' (planned) state until an agent picks it up via task_update(state='putative').",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        scope: { type: "string", description: "Coordination scope. Default 'default'." },
        depends_on: { type: "array", items: { type: "string" }, description: "Task IDs this depends on." },
        interface_nodes: { type: "array", items: { type: "string" }, description: "Shared contract node IDs the agent should read first." },
      },
      required: ["name", "description"],
    },
    handler: toolTaskCreate,
  },
  {
    name: "task_update",
    description: "Update a task's lifecycle state. speculative (planned) | putative (in_progress) | verified (done) | contested (review) | debunked (failed).",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        state: { type: "string" },
        output_node_id: { type: "string", description: "Optional: graph node ID of the agent's output." },
        notes: { type: "string", description: "Free-text agent notes for the audit trail." },
      },
      required: ["task_id", "state"],
    },
    handler: toolTaskUpdate,
  },
  {
    name: "task_query",
    description: "Fetch a task's complete envelope: name, description, current state, dependencies with their states, interface contracts, outputs, and a dispatchable boolean.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
    handler: toolTaskQuery,
  },
  {
    name: "task_list",
    description: "List coordination tasks, optionally filtered by state and/or scope.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "Filter by state. Empty = all states." },
        scope: { type: "string", description: "Filter by coordination scope. Empty = all." },
      },
    },
    handler: toolTaskList,
  },
  {
    name: "task_ready",
    description: "List tasks ready for dispatch — dependencies all verified, still in 'speculative' state.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Coordination scope to check. Default 'default'." },
      },
    },
    handler: toolTaskReady,
  },
];

// ── Server wiring ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "mnemosyne", version: "1.0.0" },
  {
    capabilities: { tools: {}, resources: {} },
    instructions: INSTRUCTIONS,
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
    };
  }
  try {
    const text = await tool.handler((req.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Tool ${tool.name} failed: ${(e as Error).message}` }],
    };
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: "mnemosyne://node/{node_id}",
      name: "Mnemosyne graph node",
      description:
        "Fetch a graph node by ID. The node_id component uses forward slashes, e.g. mnemosyne://node//pai/knowledge/ideas/foo",
      mimeType: "application/json",
    },
  ],
}));
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  const m = uri.match(/^mnemosyne:\/\/node\/(.+)$/);
  if (!m) {
    throw new Error(`Unsupported resource URI: ${uri}`);
  }
  const nodeId = m[1].startsWith("/") ? m[1] : `/${m[1]}`;
  const ann = await getNode(client(), nodeId);
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(ann, null, 2),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
