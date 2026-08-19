# Mnemosyne

> Graph-DB memory layer for PAI. Adds a persistent associative knowledge graph alongside the file-based `MEMORY/` tree.

Mnemosyne is the substrate for **graph-shaped memory**: every fact, observation, decision, or relationship is a node carrying an epistemic envelope (state, justification, scope, provenance), and every connection is a weighted edge that can itself be verified, contested, or debunked.

PAI's existing `~/.claude/PAI/MEMORY/` (markdown files) stays the source of truth. Mnemosyne is an **additive index + query surface** on top — it does not replace `KNOWLEDGE/`, `WORK/`, or `LEARNING/`. Uninstalling the pack leaves the markdown intact; the graph database is regeneratable.

---

## What you get

- **Cayley graph database** running locally on `127.0.0.1:64210` (BoltDB-backed, single file at `~/.claude/PAI/MEMORY/GRAPH/mnemosyne.bolt`).
- **MCP server** (`mnemosyne` — stdio transport) exposing 13 tools to Claude Code: `query`, `node`, `assert_node`, `assert_edge`, `recent_activity`, `list_by_state`, `list_by_scope`, `task_create`, `task_update`, `task_query`, `task_list`, `task_ready`, plus a `mnemosyne://node/{id}` resource template.
- **Substrate schemas** (epistemology + classifiers) — 386 quads defining `EpistemicState` (verified, putative, emergent, speculative, contested, debunked, fictional), `JustificationType` (empirical, inferential, testimonial, intuitive, emergent), `ContextScope`, `InferencePattern`, and a self-similar `Entity / Process / Assertion / Relationship` classifier tree.
- **Migration tool** that walks `MEMORY/KNOWLEDGE/{People,Companies,Ideas,Research}/*.md`, parses frontmatter, and asserts each file as a graph node with its tags and `[[wikilinks]]` as edges. One-shot, idempotent, re-runnable.
- **Skill at `~/.claude/skills/Mnemosyne/`** so Claude auto-invokes the tools when you ask for associative recall, knowledge-graph queries, fractal-KB navigation, or change catch-up.

---

## Why a graph alongside files

Markdown files are great for browsing and editing. They are awkward for:

- **Associative recall** — "show me everything connected to X within 2 hops, restricted to `pai:work` scope, with epistemic state `verified` or better." `rg` can't do this.
- **Edge metadata** — a link in markdown has no weight, direction, or epistemic state. In Mnemosyne, every edge carries those.
- **Catch-up** — `recent_activity(since=...)` returns nodes touched since a timestamp. New sessions and spawned agents use this instead of asking the user to re-explain.
- **Coordination** — tasks are first-class nodes. Their epistemic state IS their lifecycle (speculative=planned → putative=in-progress → verified=done → contested=review → debunked=failed). Dependencies are `derives_from` edges. `task_ready` returns dispatchable work.

The graph is regeneratable from the markdown layer. The markdown layer is not regeneratable from the graph. Files win for permanence; the graph wins for query.

---

## Architecture

```
~/.claude/PAI/MEMORY/          ← markdown (source of truth, gitable, human-editable)
├── KNOWLEDGE/                 ← entity-based notes (People, Companies, Ideas, Research)
├── WORK/                      ← ISAs per session
├── LEARNING/                  ← ratings, failures, synthesis
└── GRAPH/                     ← Mnemosyne (regeneratable index)
    └── mnemosyne.bolt         ← single-file Cayley BoltDB

Local Cayley HTTP API ←─────────── MCP server (stdio) ←─────────── Claude Code
       127.0.0.1:64210                 ${PAI_DIR}/skills/Mnemosyne/Tools/McpServer.ts
```

The MCP server is a thin shim. All persistence lives in Cayley. All query logic is expressible as Gizmo (JavaScript) over Cayley's HTTP endpoint.

---

## Epistemic vocabulary

Every node carries:

| Field | Values |
|---|---|
| `epistemic_state` | `verified` (rank 1) > `putative`/`emergent` (rank 2) > `speculative` (rank 3) > `contested` (rank 4) > `debunked`/`fictional` (rank 5) |
| `justification` | `empirical` (measured) · `inferential` (derived) · `testimonial` (reported) · `intuitive` (pattern-matched) · `emergent` (from inside-out closure) |
| `scope` | `physical_reality`, `pai:memory`, `pai:knowledge`, `pai:work`, `pai:learning`, `pai:project` — claims hold WITHIN a scope. The same node can be `verified` in one scope and `fictional` in another. |
| `node_type` | `/classifier/entity/{agent,artifact,concept,place}` · `/classifier/process/{physical,cognitive,communicative,emergent}` · `/classifier/assertion/{observation,inference,prediction,model}` · `/classifier/relationship/{causal,structural,temporal,epistemic}` |

The default `epistemic_floor` for `query` is `speculative` — verified + putative + emergent + speculative are returned, contested/debunked/fictional are excluded.

---

## Primary query — `inside_out_query`

Start from any node. Scale outward to the surrounding cluster within `depth` hops. Prune by scope and epistemic floor. Return the surviving subgraph.

```
query(
  start_node="/pai/knowledge/ideas/agentic-core-loop",
  scope="pai:knowledge",
  epistemic_floor="putative",
  depth=2,
  max_nodes=50
)
```

Self-similar: the same call works whether `start_node` is a leaf concept or a top-level domain node. There is no special case for interior vs. leaf.

---

## Catch-up — `recent_activity`

When a session resumes or an agent is spawned, call `recent_activity(since=...)` with the timestamp of last contact. Returns `{node_id, written_at}` sorted newest-first. Every write through `assert_node`, `assert_edge`, `task_create`, and `task_update` stamps `/epistemology/edge/written_at` on the touched subjects, so the graph self-describes its own change history.

---

## Optional cloud backend

Local-first by default. Cayley can also run on a remote VM, with the MCP server tunneling over SSE. The pack ships a stub `src/References/CloudDeployment.md` describing the GCP layout (Cayley VM, VPC, IAP-only SSH, BoltDB on persistent disk, Secret Manager for any user-supplied keys). The cloud path is documentation-only — no GCP code, no project IDs, no terraform shipped here.

If you want cloud deployment, see `References/CloudDeployment.md` for the recommended GCP topology. AWS/Azure equivalents are intentionally not provided; pick a single cloud and adapt.

---

## What's NOT in this pack

- **No domain-specific schemas.** The substrate ships epistemology + classifiers only. Research-domain schemas (e.g. cetacean acoustics, RPG narrative persistence) lived in the original mnemosyne stack — they are intentionally excluded from this public pack because they encode personal research. Add your own domain schemas under `src/Schemas/` and the seeder will pick them up.
- **No GCP/Terraform code.** Cloud deployment is documented as a topology; code is left to the operator.
- **No personal scopes.** The seed includes `physical_reality` plus PAI-system scopes. Add your own narrative or domain scopes by extending `src/Schemas/scopes.nq`.

---

## Install

Point your DA at this directory:

```
"Install the Mnemosyne pack from PAI/Packs/Mnemosyne/"
```

The DA reads `INSTALL.md` and walks through the 5-phase wizard. Pre-reqs: Cayley binary (the installer will check for `brew` and offer to install), Bun, and write access to `~/.claude/`.

Verification commands are in `VERIFY.md`.

---

## Files

| Path | Purpose |
|---|---|
| `src/SKILL.md` | Skill activator — tells Claude when to invoke the MCP tools |
| `src/Workflows/QueryGraph.md` | Inside-out query workflow |
| `src/Workflows/AssertKnowledge.md` | Writing nodes + edges with epistemic envelope |
| `src/Workflows/RecentActivity.md` | Catch-up workflow for resumed sessions |
| `src/Workflows/MigrateFromFiles.md` | One-shot import of `MEMORY/KNOWLEDGE/` into the graph |
| `src/References/Architecture.md` | Integration design — how Mnemosyne sits next to file-based MEMORY |
| `src/References/SchemaGuide.md` | Predicate vocabulary, scope catalogue, classifier tree |
| `src/References/CloudDeployment.md` | Optional GCP topology (documentation only) |
| `src/Schemas/epistemology.nq` | Substrate: epistemic states, justification, scopes, edges |
| `src/Schemas/classifiers.nq` | Substrate: self-similar entity/process/assertion/relationship taxonomy |
| `src/Schemas/scopes.nq` | PAI-native context scopes (extend this for your domains) |
| `src/Config/cayley.yml` | Cayley BoltDB config (single-file local store) |
| `src/Tools/CayleyClient.ts` | HTTP wrapper for Cayley's Gizmo + write endpoints |
| `src/Tools/InsideOut.ts` | Query engine (depth-bounded BFS + epistemic pruning) |
| `src/Tools/McpServer.ts` | MCP server, stdio transport, 13 tools |
| `src/Tools/SeedSchemas.ts` | Parse + load `.nq` files into running Cayley |
| `src/Tools/StartLocal.ts` | Start local Cayley with the pack's config |
| `src/Tools/MigrateKnowledge.ts` | Import `MEMORY/KNOWLEDGE/**/*.md` into the graph |
