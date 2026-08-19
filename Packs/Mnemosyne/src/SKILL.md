---
name: Mnemosyne
description: Persistent associative knowledge graph backed by a local Cayley database. Adds 13 MCP tools (query, node, assert_node, assert_edge, recent_activity, list_by_state, list_by_scope, task_create, task_update, task_query, task_list, task_ready, plus a mnemosyne://node/{id} resource) on top of PAI's file-based MEMORY/. Every node carries an epistemic envelope — epistemic_state (verified, putative, emergent, speculative, contested, debunked, fictional), justification (empirical, inferential, testimonial, intuitive, emergent), scope (physical_reality, pai:memory, pai:knowledge, pai:work, pai:learning, pai:project), and provenance. Edges are weighted, directional, and reified via the CVT pattern so each edge carries its own epistemic envelope. The primary query is inside_out_query — start from any node, scale outward, prune by scope and epistemic floor, return the surviving subgraph; self-similar at any abstraction level. Catch-up primitive is recent_activity(since=...) — every write timestamps the touched subjects via /epistemology/edge/written_at, so a resumed session or spawned agent can discover what changed since last contact without asking the user to re-explain. Coordination tools treat tasks as first-class nodes whose epistemic state IS their lifecycle (speculative=planned, putative=in-progress, verified=done, contested=review, debunked=failed), with derives_from edges as dependencies and task_ready returning dispatchable work. Graph storage lives at ~/.claude/PAI/MEMORY/GRAPH/mnemosyne.bolt (BoltDB), regeneratable from MEMORY/KNOWLEDGE/ via MigrateKnowledge.ts. PAI's file-based MEMORY/ remains source of truth; Mnemosyne is an additive index. USE WHEN graph query, knowledge graph, associative recall, what's connected to, find related, fractal knowledge, recent activity, what changed, catch up session, scope query, epistemic state, verified facts, assert node, assert edge, contradicts, supports, derives from, task dependencies, task ready, dispatch task, mnemosyne, cayley, inside-out query, list by scope, list by state.
---

# Mnemosyne

Persistent associative knowledge graph backed by a local Cayley database. Adds graph-shaped memory alongside PAI's file-based `MEMORY/`.

## When to use

- The user asks "what's connected to X" / "show me everything related to Y" — `query` with `inside_out` pattern.
- The user resumes a session or you've been spawned as an agent — call `recent_activity(since=24h-ago)` BEFORE asking what's going on. The graph tells you what changed.
- The user makes a claim worth tracking (observation, prediction, belief, decision) — `assert_node` with appropriate epistemic state.
- The user describes a relationship between two known things — `assert_edge` with weight + direction.
- The user wants to see verified vs. contested facts in a topic — `list_by_state` + `list_by_scope`.
- You're coordinating multi-step work where dependencies matter — `task_create` with `depends_on`, `task_ready` to find dispatchable work.

## When NOT to use

- Reading a specific markdown file — use `Read`. The graph indexes structure, not content.
- Searching plaintext — use `Grep` over `~/.claude/PAI/MEMORY/`. Mnemosyne queries structure, not strings.
- Writing user-facing notes — write to `MEMORY/KNOWLEDGE/`, then the next migration run picks them up.
- The graph isn't running — `mcp__mnemosyne__*` tools won't appear. Boot Cayley first: `bun ~/.claude/skills/Mnemosyne/Tools/StartLocal.ts`.

## Epistemic vocabulary

| `epistemic_state` | rank | meaning |
|---|---|---|
| `verified` | 1 | Independently replicated; prediction record positive |
| `putative` | 2 | Plausible, evidence present, not stress-tested |
| `emergent` | 2 | Arose from inside-out closure; no single agent anticipated it |
| `speculative` | 3 | Structurally coherent, minimal direct evidence |
| `contested` | 4 | Active conflict between supporting and contradicting evidence |
| `debunked` | 5 | Falsification succeeded. Preserved for provenance, never deleted |
| `fictional` | 5 | True within a scoped narrative context, false outside it |

Default `epistemic_floor` for `query` is `speculative` — verified + putative + emergent + speculative are returned; contested + debunked + fictional are excluded.

| `justification` | meaning |
|---|---|
| `empirical` | Direct measurement or observation |
| `inferential` | Derived from other verified/putative nodes |
| `testimonial` | Reported by a trusted agent |
| `intuitive` | Pattern recognition without explicit chain — flag for verification, not dismissal |
| `emergent` | Product of inside-out closure; structurally justified |

| `scope` | meaning |
|---|---|
| `physical_reality` | Claims that hold in the world |
| `pai:memory` | PAI runtime memory layer (default for migrated KNOWLEDGE/) |
| `pai:knowledge` | Curated KNOWLEDGE/ entries |
| `pai:work` | Work session ISA tracking |
| `pai:learning` | LEARNING/ extracts (failures, signals, synthesis) |
| `pai:project` | Per-project scope; suffix with project name as needed |

Same node can be `verified` in one scope and `fictional` in another. Scope is the context; epistemic_state is the truth value within that context.

## Tool catalogue

| Tool | When to call |
|------|---|
| `query` | Primary discovery — "what's around X?" Scales outward from a start node, prunes by scope + epistemic floor, returns subgraph. Default depth=2, max_nodes=50. |
| `node` | Fetch one node's full envelope (name, description, types, state, scopes). Use after `query` returns IDs you want to inspect. |
| `assert_node` | Add a new node. Required: id, name, description, type, state, scope. Optional: justification, provenance. |
| `assert_edge` | Add a relationship. Subject + predicate + object + direction (forward/reverse/bidirectional) + weight (0–1) + state + scope. Idempotent via SHA1 instance ID. |
| `recent_activity` | Catch-up. Pass `since` as ISO-8601 UTC. Returns nodes touched after that, newest first. Pre-write nodes (no `written_at`) won't appear. |
| `list_by_state` | All nodes at a given epistemic state. Useful for "show me what we treat as verified." |
| `list_by_scope` | All nodes in a given scope. Useful for "show me everything in `pai:project:foo`." |
| `task_create` | New coordination task. Starts in `speculative` (planned). Pass `depends_on` to gate dispatch. |
| `task_update` | Move task through lifecycle: `speculative` → `putative` (started) → `verified` (done) or `debunked` (failed) or `contested` (review). |
| `task_query` | Full envelope of one task: state, deps, dep states, interfaces, outputs, dispatchable boolean. |
| `task_list` | Filtered task listing. Pass state + scope to slice. |
| `task_ready` | Tasks whose deps are all `verified` and that are still `speculative` — dispatchable now. |
| `mnemosyne://node/{id}` (resource) | Same as `node` tool but addressable as an MCP resource URI. |

## Primary patterns

### Inside-out query — the default discovery move

```
mcp__mnemosyne__query(
  start_node="/pai/knowledge/ideas/agentic-core-loop",
  scope="pai:knowledge",
  epistemic_floor="putative",
  depth=2,
  max_nodes=50
)
```

Self-similar — same call works for a leaf concept or a domain root. Increase `depth` only when explicitly needed; the cluster around `start_node` at depth=2 is usually enough.

### Catch-up on session resume

When a session starts and you suspect the graph has been touched since last contact:

```
mcp__mnemosyne__recent_activity(since="2026-05-25T00:00:00Z", limit=20)
```

Skim the returned IDs. If any look load-bearing for the user's request, follow up with `node(id)` or `query(start_node=id, ...)`.

### Assert a new observation

```
mcp__mnemosyne__assert_node(
  node_id="/pai/observation/bun-faster-than-npm",
  name="bun faster than npm for installs",
  description="Empirically bun install < 5s vs npm install ~30s on PAI tooling",
  node_type="/classifier/assertion/observation",
  epistemic_state="verified",
  scope="pai:memory",
  justification="empirical",
  provenance="benchmarked 2026-05-26 on macOS"
)
```

### Link two existing nodes

```
mcp__mnemosyne__assert_edge(
  subject_id="/pai/observation/bun-faster-than-npm",
  predicate="/epistemology/edge/supports",
  object_id="/pai/decision/use-bun-over-npm",
  direction="forward",
  weight=0.9,
  epistemic_state="putative",
  scope="pai:memory"
)
```

The edge gets a deterministic SHA1 instance ID so re-asserting the same `(subject, predicate, object)` updates metadata without creating duplicates.

## Integration with file-based MEMORY/

Mnemosyne does NOT replace `~/.claude/PAI/MEMORY/`. The relationship:

- **`MEMORY/KNOWLEDGE/*.md`** is the human-editable source. Edit there.
- **`MEMORY/GRAPH/mnemosyne.bolt`** is the regeneratable index. Auto-built by `MigrateKnowledge.ts` and updated by `assert_*` tool calls.
- **`recent_activity`** discovers nodes touched since a timestamp. New markdown edits show up only after re-migration. Inline graph writes (`assert_*`) show up immediately.
- **`MEMORY/WORK/`** ISAs can be mirrored into the graph as `/coordination/task` nodes — but the ISA markdown remains canonical for human review.

The principle: markdown for permanence, graph for query. Files win for editing and version control. The graph wins for associative recall, edge metadata, and catch-up.

## Related skills

- **Knowledge** — Manages the entity-based markdown archive at `MEMORY/KNOWLEDGE/`. Mnemosyne indexes its output.
- **ISA** — Owns ISA scaffolds in `MEMORY/WORK/`. Mnemosyne can mirror ISAs as coordination task nodes when multi-agent dispatch matters.
- **Knowledge MemoryRetriever / KnowledgeGraph** — File-based BM25 + in-memory graph over markdown. Complementary: those are for narrowing on text; Mnemosyne is for traversing structure with epistemic envelopes.

## See also

- `Workflows/QueryGraph.md` — how to compose `query` calls
- `Workflows/AssertKnowledge.md` — when to use which `epistemic_state` + `justification`
- `Workflows/RecentActivity.md` — catch-up patterns
- `Workflows/MigrateFromFiles.md` — re-running KNOWLEDGE/ → graph import
- `References/SchemaGuide.md` — full predicate + scope + classifier vocabulary
- `References/Architecture.md` — how the pack sits next to file-based MEMORY/
- `References/CloudDeployment.md` — optional GCP topology (doc-only)
