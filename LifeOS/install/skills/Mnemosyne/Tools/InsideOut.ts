/**
 * InsideOut — the inside-out query engine.
 *
 * Pattern: start_node → scale_up → collect_cluster → prune → return subgraph.
 * Self-similar: the same algorithm and parameter shapes work at any abstraction
 * level in the graph. There is no special case for leaf vs. interior nodes.
 *
 * Epistemic floor semantics: state_rank <= floor_rank.
 * verified=1, putative=2, emergent=2, speculative=3, contested=4,
 * debunked=5, fictional=5.
 * "speculative" floor is the default: includes everything except contested,
 * debunked, and fictional.
 *
 * Ported from src/query_host/inside_out.py in the upstream mnemosyne stack.
 */

import { CayleyClient, escapeNodeId, stripLiteralQuotes } from "./CayleyClient";

export const EPISTEMIC_RANKS: Record<string, number> = {
  verified: 1,
  putative: 2,
  emergent: 2,
  speculative: 3,
  contested: 4,
  debunked: 5,
  fictional: 5,
};

const STRUCTURAL_PREFIXES = ["/type/", "/common/"] as const;

export function isStructural(nodeId: string): boolean {
  return STRUCTURAL_PREFIXES.some((p) => nodeId.startsWith(p));
}

export type NodeAnnotation = {
  id: string;
  name: string;
  description: string;
  types: string[];
  epistemic_state: string;
  state_rank: number;
  scopes: string[];
};

export type InsideOutResult = {
  start_node: string;
  scope_filter: string | null;
  epistemic_floor: string;
  depth: number;
  node_count: number;
  nodes: NodeAnnotation[];
};

export async function insideOutQuery(
  client: CayleyClient,
  opts: {
    start_node: string;
    scope?: string | null;
    epistemic_floor?: string;
    depth?: number;
    max_nodes?: number;
  },
): Promise<InsideOutResult> {
  const start_node = opts.start_node;
  const scope = opts.scope ?? null;
  const epistemic_floor = opts.epistemic_floor ?? "speculative";
  const depth = Math.max(1, Math.min(opts.depth ?? 2, 4));
  const max_nodes = opts.max_nodes ?? 50;

  const floorRank = EPISTEMIC_RANKS[epistemic_floor] ?? 3;

  const rawIds = await collectNeighbors(client, start_node, depth, max_nodes);
  const semanticIds = rawIds.filter((id) => !isStructural(id));

  const survivors: NodeAnnotation[] = [];
  for (const nid of semanticIds) {
    const ann = await annotateNode(client, nid);
    if (ann.state_rank > floorRank) continue;
    if (scope && ann.scopes.length > 0 && !ann.scopes.includes(scope)) continue;
    survivors.push(ann);
  }

  return {
    start_node,
    scope_filter: scope,
    epistemic_floor,
    depth,
    node_count: survivors.length,
    nodes: survivors,
  };
}

export async function getNode(
  client: CayleyClient,
  nodeId: string,
): Promise<NodeAnnotation> {
  return annotateNode(client, nodeId);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function collectNeighbors(
  client: CayleyClient,
  startNode: string,
  depth: number,
  maxNodes: number,
): Promise<string[]> {
  const escaped = escapeNodeId(startNode);
  let script: string;
  if (depth === 1) {
    script = `g.V("${escaped}").Both().GetLimit(${maxNodes})`;
  } else {
    const hops = ".Both()".repeat(depth);
    script = `g.V("${escaped}")${hops}.Unique().GetLimit(${maxNodes})`;
  }
  const r = await client.queryGizmo(script);
  const nodes = (r.result as Array<{ id?: string }> | null) ?? [];
  return nodes.filter((n) => n && n.id).map((n) => n.id!);
}

async function annotateNode(
  client: CayleyClient,
  nodeId: string,
): Promise<NodeAnnotation> {
  const ann: NodeAnnotation = {
    id: nodeId,
    name: "",
    description: "",
    types: [],
    epistemic_state: "speculative",
    state_rank: 3,
    scopes: [],
  };
  const escaped = escapeNodeId(nodeId);

  // Name
  {
    const r = await client.queryGizmo(
      `g.V("${escaped}").Out("/type/object/name").GetLimit(1)`,
    );
    const items = (r.result as Array<{ id?: string }> | null) ?? [];
    if (items[0]?.id) ann.name = stripLiteralQuotes(items[0].id);
  }

  // Description
  {
    const r = await client.queryGizmo(
      `g.V("${escaped}").Out("/common/topic/description").GetLimit(1)`,
    );
    const items = (r.result as Array<{ id?: string }> | null) ?? [];
    if (items[0]?.id) ann.description = stripLiteralQuotes(items[0].id);
  }

  // Types
  {
    const r = await client.queryGizmo(
      `g.V("${escaped}").Out("/type/object/type").GetLimit(10)`,
    );
    const items = (r.result as Array<{ id?: string }> | null) ?? [];
    ann.types = items
      .filter((n) => n && n.id && !isStructural(n.id))
      .map((n) => n.id!);
  }

  // Epistemic state
  {
    const r = await client.queryGizmo(
      `g.V("${escaped}").Out("/epistemology/edge/has_state").GetLimit(1)`,
    );
    const items = (r.result as Array<{ id?: string }> | null) ?? [];
    const stateNode = items[0]?.id ?? "";
    const stateName = stateNode.split("/").pop() ?? "";
    if (stateName in EPISTEMIC_RANKS) {
      ann.epistemic_state = stateName;
      ann.state_rank = EPISTEMIC_RANKS[stateName];
    }
  }

  // Scopes
  {
    const r = await client.queryGizmo(
      `g.V("${escaped}").Out("/epistemology/edge/scoped_to").GetLimit(10)`,
    );
    const items = (r.result as Array<{ id?: string }> | null) ?? [];
    ann.scopes = items
      .filter((n) => n && n.id)
      .map((n) => n.id!.split("/").pop() ?? "");
  }

  return ann;
}
