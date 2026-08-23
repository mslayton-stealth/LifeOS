# Architecture: How Mnemosyne sits next to file-based MEMORY/

Mnemosyne is **additive**. PAI's `~/.claude/PAI/MEMORY/` file tree (KNOWLEDGE/, WORK/, LEARNING/, RESEARCH/, STATE/) stays the canonical layer. The graph is an index + query surface on top.

## The two layers

| Layer | Lives at | Source of truth for | Strengths | Weaknesses |
|---|---|---|---|---|
| Markdown | `~/.claude/PAI/MEMORY/` | Note content, frontmatter, edit history | Human-editable, gitable, plaintext-searchable | No edge metadata, no associative recall, no temporal change feed |
| Graph | `~/.claude/PAI/MEMORY/GRAPH/mnemosyne.bolt` | Structural index, edge envelopes, coordination state | Associative traversal, scope/state pruning, `recent_activity` | Opaque store, regeneratable not authoritative |

**Rule of thumb:** if you'd `cat` it, it lives in markdown. If you'd traverse it, it lives in the graph.

## Data flow

```
                ┌──────────────────────────────────────────────────────────┐
                │            ~/.claude/PAI/MEMORY/                          │
                │                                                            │
   ┌────────┐   │   ┌─────────────┐  ┌──────────┐  ┌──────────────┐         │
   │  user  │───┼──▶│  KNOWLEDGE/ │  │   WORK/  │  │   LEARNING/  │         │
   │  edits │   │   │   *.md      │  │  ISA.md  │  │ failures, ...│         │
   └────────┘   │   └──────┬──────┘  └────┬─────┘  └──────┬───────┘         │
                │          │              │                │                 │
                └──────────┼──────────────┼────────────────┼─────────────────┘
                           │              │                │
                           ▼              ▼                ▼
                   ┌──────────────────────────────────────────────┐
                   │  MigrateKnowledge.ts (one-shot)              │
                   │   - parses frontmatter                       │
                   │   - extracts wikilinks                       │
                   │   - emits assert_node + assert_edge          │
                   └─────────────────┬────────────────────────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │   Cayley HTTP API    │◀─── assert_*, query, ...
                          │  127.0.0.1:64210     │     via mcp__mnemosyne__*
                          └──────────┬───────────┘
                                     │
                                     ▼
                       ~/.claude/PAI/MEMORY/GRAPH/mnemosyne.bolt
```

Three writers reach the graph:

1. **Migration** (`MigrateKnowledge.ts`) — periodic bulk import from `KNOWLEDGE/`.
2. **Inline assertions** (`assert_node`, `assert_edge`) — during sessions, via MCP tool calls.
3. **Coordination** (`task_*`) — multi-agent dispatch, during Algorithm runs or Delegation flows.

The markdown layer has its own writers (Algorithm LEARN phase, KnowledgeHarvester, SessionHarvester, manual edits). Those continue to write to markdown; the graph only learns about them on the next migration run.

## Why additive (not replacement)

Three reasons:

1. **Upstream review.** This pack targets contribution back to `danielmiessler/Personal_AI_Infrastructure`. Replacing the file-based memory would force every PAI user to install Cayley. Additive lets the graph be opt-in.
2. **Permanence.** Markdown survives. A BoltDB file does too, but it's opaque — `git diff` can't show what changed inside it, and recovery from corruption is harder. Markdown is the durable layer.
3. **Tool overlap.** PAI's existing `MemoryRetriever.ts` (BM25 + LLM) and `KnowledgeGraph.ts` (in-memory tag/wikilink graph) work on markdown directly. Mnemosyne adds a **third** lens — structural traversal with epistemic envelopes — without displacing the other two.

## Where the graph wins

| Question | File-based tools | Mnemosyne |
|---|---|---|
| "Find me notes mentioning X" | `Grep` or `MemoryRetriever` (BM25) | Not its strength — use file tools |
| "What's connected to X within 2 hops, only verified?" | Impossible — links carry no epistemic state | `query(start_node=X, depth=2, epistemic_floor=verified)` |
| "What changed in the last 24 hours?" | `git log` (file edits) | `recent_activity(since=24h)` (graph touches) |
| "What's contested or contradicted?" | Possible via frontmatter conventions | First-class: `list_by_state(epistemic_state=contested)` |
| "Which tasks are dispatchable right now?" | Manual dep tracking | `task_ready(scope=...)` |

## Where the file layer wins

| Question | Mnemosyne | File-based tools |
|---|---|---|
| "Show me the canonical text for note X" | Returns the truncated description | `Read MEMORY/KNOWLEDGE/.../X.md` |
| "Plain-text search for 'docker'" | Not its strength | `Grep -r 'docker' MEMORY/` |
| "Diff what I wrote vs. last week" | No history | `git diff HEAD~7 -- MEMORY/` |
| "Open in editor" | Can't | Direct file path |

## Mirror, don't migrate, transient state

Some `MEMORY/` content is intentionally NOT in the graph:

- **`STATE/`** — runtime ephemera. Rebuilt from other sources; no point indexing.
- **`LEARNING/SIGNALS/ratings.jsonl`** — high-volume append log. Aggregate it (LearningPatternSynthesis) and assert the aggregates.
- **`PAISYSTEMUPDATES/`** — change log. Asserting each update as a node is fine, but the markdown remains the audit artifact.

The migration tool only walks `KNOWLEDGE/{People,Companies,Ideas,Research}`. Other directories are deliberately excluded.

## Hooks integration (future)

This pack does NOT ship hooks. Possible future additions:

- `PostToolUse(Write|Edit)` matching `MEMORY/KNOWLEDGE/**/*.md` → trigger incremental re-migration of the changed file.
- `Algorithm LEARN phase` → mirror new KNOWLEDGE/ writes to the graph in the same pass, so the graph stays warm without a separate migration.
- `WorkCompletionLearning` → mirror ISAs as `/coordination/task` nodes so `task_query` reflects work history.

These are upstream-design decisions. The pack ships the substrate; hooks are a separate concern.

## Storage layout

```
~/.claude/PAI/MEMORY/GRAPH/
├── cayley.yml          # Rendered at install: store=bolt, address=mnemosyne.bolt
├── cayley.log          # Cayley stdout/stderr
└── mnemosyne.bolt      # Single BoltDB file — the entire graph
```

The graph is one file. Back it up with `cp mnemosyne.bolt mnemosyne.bolt.bak` (Cayley must be stopped first, or `nosync: true` and a quiescent moment). To reset, stop Cayley and `rm mnemosyne.bolt mnemosyne.bolt.lock`.

## What's not here

- **No multi-node cluster.** Cayley supports clustering; this pack runs single-node BoltDB only. Multi-node is overkill for a personal memory layer.
- **No vector embeddings.** The graph indexes structure, not semantic similarity. If you want semantic retrieval, use `MemoryRetriever.ts` (BM25 today, vector-backed later). The two are complementary.
- **No GraphQL.** Cayley speaks Gizmo (JavaScript), GQL (a different one), and MQL. The MCP server only exposes Gizmo internally.
- **No federation.** Each PAI install runs its own graph. Sharing graphs across users would require an export/import format (the `.nq` files come close — they're the lingua franca).
