# Workflow: Query the Graph

Inside-out query is the primary Mnemosyne discovery pattern. Start from any node, scale outward to its cluster, prune by scope and epistemic certainty, return the surviving subgraph. Self-similar — the same call shape works at any abstraction level.

## When to use

- "What's connected to X?"
- "Show me everything related to Y."
- "Walk me from concept A out two hops, but only verified facts."
- "What's in scope `pai:project:foo`?"

## When NOT to use

- You need plain-text search over notes — use `Grep` over `~/.claude/PAI/MEMORY/` instead.
- You want a single node's contents — use the `node` tool, not `query`.
- The graph isn't running — `mcp__mnemosyne__*` tools won't appear. Run `bun ~/.claude/skills/Mnemosyne/Tools/StartLocal.ts` first.

## Call shape

```
mcp__mnemosyne__query(
  start_node="/pai/knowledge/ideas/agentic-core-loop",
  scope="pai:knowledge",
  epistemic_floor="putative",
  depth=2,
  max_nodes=50
)
```

| Parameter | Default | Notes |
|---|---|---|
| `start_node` | required | Cayley node ID with leading slash |
| `scope` | none | Restrict to a ContextScope. Pass `any` / `all` / omit for no filter. |
| `epistemic_floor` | `speculative` | Floor is inclusive. Default returns verified + putative + emergent + speculative. |
| `depth` | `2` | 1–4 hops. Most clusters are visible at depth 2; only go deeper for ontology root navigation. |
| `max_nodes` | `50` | Hard cap. Reduce for tighter responses; raise for survey queries. |

## Epistemic floor semantics

| Floor | Returned |
|---|---|
| `verified` | only verified (rank 1) |
| `putative` | verified, putative, emergent (rank ≤ 2) |
| `speculative` | verified, putative, emergent, speculative (rank ≤ 3) — **default** |
| `contested` | adds contested (rank ≤ 4) |
| `debunked` / `fictional` | everything (rank ≤ 5) — use for forensic / historical work |

## Output shape

```json
{
  "start_node": "/pai/knowledge/ideas/agentic-core-loop",
  "scope_filter": "pai:knowledge",
  "epistemic_floor": "putative",
  "depth": 2,
  "node_count": 7,
  "nodes": [
    {
      "id": "...",
      "name": "...",
      "description": "...",
      "types": ["/classifier/..."],
      "epistemic_state": "putative",
      "state_rank": 2,
      "scopes": ["pai_knowledge"]
    },
    ...
  ]
}
```

Each node carries its full envelope, so you can decide downstream whether to fetch the canonical markdown via `Read`, query deeper with `node`, or write a follow-up assertion with `assert_node`.

## Composition patterns

### Scoped survey

When the user asks "what do we have in scope X":

```
mcp__mnemosyne__list_by_scope(scope="pai:project:foo", limit=200)
```

Then for the IDs that look load-bearing, follow up with:

```
mcp__mnemosyne__query(start_node=id, scope="pai:project:foo", depth=2)
```

### Verified-only audit

For "what do we hold as verified":

```
mcp__mnemosyne__list_by_state(epistemic_state="verified", limit=200)
```

This is the audit query — every verified node should have either a `PredictiveRecord` with confirmed outcome OR an `EvidenceNode` chain reaching empirical observations. If you find a verified node with no supporting structure, that's a warning sign.

### Cluster comparison

To compare two clusters:

```
A = mcp__mnemosyne__query(start_node=X, depth=2)
B = mcp__mnemosyne__query(start_node=Y, depth=2)
```

Then diff `A.nodes[].id` vs `B.nodes[].id` to find the bridge nodes — the overlap.

## Anti-patterns

- **Setting `depth=4` by default** — wastes traversal budget. Start at 2; only deepen when the depth-2 cluster is missing the connection you're hunting for.
- **Setting `max_nodes=500`** — Cayley returns quickly but you flood your own context window. Cap at 50–100 unless you're doing an audit.
- **Querying with `epistemic_floor="fictional"`** routinely — you'll get noise. Use this only when investigating contradictions or running a forensic check.
- **Re-querying when you already have the node** — use `node(node_id)` for single-node fetches. `query` is for cluster discovery.
