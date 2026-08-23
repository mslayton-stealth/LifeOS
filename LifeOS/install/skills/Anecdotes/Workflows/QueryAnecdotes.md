# Workflow: Query Anecdotes

Retrieval is two-tier: the dedicated CLI for one-shot terminal use, and Mnemosyne's MCP tools for in-session queries from Claude Code.

## The CLI — `AnecdotesCli.ts query`

One-line filtered lookups. All produce JSON output you can pipe through `jq`.

```bash
# By tag
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-tag patience

# By domain
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-domain physics

# By contributor
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-contributor /anecdote/contributor/franklin

# By modality
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-modality dialectic

# By scope (defaults to anecdotes:prototype)
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --scope anecdotes:prototype --limit 50

# Pretty-print with insights
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-domain physics \
  | jq -r '.[] | "\(.title)\n  insight: \(.insight)\n"'
```

`--limit` defaults to 20.

## Mnemosyne MCP — for in-session use

When working in a Claude Code session, query via the existing Mnemosyne tools. No separate Anecdotes MCP server exists.

### List all anecdotes

```
mcp__mnemosyne__list_by_scope(scope="anecdotes:prototype", limit=50)
```

Returns `{node_count, nodes: [id, ...]}`. The IDs follow the pattern `/anecdote/anecdote/<contributor_slug>/<title-slug>_<hash>`.

### Fetch one anecdote's full envelope

```
mcp__mnemosyne__node(node_id="/anecdote/anecdote/franklin/the-water-american_abc123")
```

Returns `{id, name (= title), description, types, epistemic_state, state_rank, scopes}`. Note that the four narrative fields (setup/complication/resolution/insight) live on dedicated predicates — to read them all, use a small Gizmo query directly or use the CLI `query` command which assembles them.

### Walk a contributor's anecdotes

```
mcp__mnemosyne__query(
  start_node="/anecdote/contributor/franklin",
  depth=1,
  max_nodes=100
)
```

The inside-out query returns the contributor + all anecdotes that point to them via `contributed_by`.

### Find anecdotes mentioning a character

```
mcp__mnemosyne__query(start_node="/anecdote/character/<slug>", depth=1)
```

Characters are nodes — `mentions_character` edges point at them.

### Find anecdotes by tag (graph traversal)

```
mcp__mnemosyne__query(start_node="/anecdote/tag/patience", depth=1)
```

Tags are nodes. Each anecdote has zero-or-more `has_tag` edges to `/anecdote/tag/<slug>`.

### List all anecdotes with a given modality

```
mcp__mnemosyne__query(start_node="/anecdote/modality/dialectic", depth=1, max_nodes=200)
```

The modality node is the hub — all dialectic anecdotes edge into it via `has_modality`.

### Recent anecdotes (catch-up)

```
mcp__mnemosyne__recent_activity(since="2026-05-25T00:00:00Z", scope="anecdotes:prototype", limit=20)
```

Returns newly-asserted anecdotes after the timestamp. Use this in subagent catch-up flows.

## Gizmo queries (Cayley HTTP API directly)

For ad-hoc inspection that the canned tools don't cover, drop to Gizmo:

```bash
# Count anecdotes by modality
for m in dictated reflective curated dialectic interview; do
  COUNT=$(curl -sf -X POST -d \
    "g.V(\"/anecdote/modality/$m\").In(\"/anecdote/edge/has_modality\").Count()" \
    http://localhost:64211/api/v1/query/gizmo)
  echo "$m: $COUNT"
done

# Top tags by usage
curl -sf -X POST -d \
  'g.V().Out("/anecdote/edge/has_tag").Tag("t").Count()' \
  http://localhost:64211/api/v1/query/gizmo

# All anecdotes from any contributor with status=historical
curl -sf -X POST -d \
  'g.V("/anecdote/contributor_status/historical").In("/anecdote/contributor/status").In("/anecdote/edge/contributed_by").GetLimit(50)' \
  http://localhost:64211/api/v1/query/gizmo
```

## Composing filters

The CLI's `query` subcommand takes one filter at a time. For compound filters, post-process with `jq`:

```bash
# Physics anecdotes tagged "elegance"
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-domain physics \
  | jq '[.[] | select(.tags | index("elegance"))]'

# Reflective anecdotes from any historical contributor
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-modality reflective \
  | jq '[.[] | select(.contributor_status == "historical")]'
```

For heavy compound queries, write a Gizmo script and POST it directly — that's faster than CLI + jq.

## Output shape

The CLI emits an array of `AnecdoteRecord`:

```json
[
  {
    "id": "/anecdote/anecdote/franklin/the-water-american_abc123",
    "title": "the water american",
    "modality": "reflective",
    "setup": "...",
    "complication": "...",
    "resolution": "...",
    "insight": "...",
    "insight_explicit": true,
    "contributor": "/anecdote/contributor/franklin",
    "contributor_name": "Benjamin Franklin",
    "domains": ["civic_life"],
    "tags": ["temperance", "labor", "social_norms"],
    "characters": ["Franklin", "Watts"],
    "source_excerpt": "..."
  }
]
```

Dialectic anecdotes include an `utterances` array; non-dialectic omit it.

## Performance notes

- `list_by_scope` and `query` over Mnemosyne MCP are O(graph size in scope). For a personal anecdote library (hundreds to thousands), single-digit milliseconds. For 100k+, switch to scope partitioning (`anecdotes:prototype:franklin`, `anecdotes:prototype:twain`, etc.) and query per-partition.
- The CLI `query` does multiple Gizmo round-trips per anecdote (fetching setup/complication/etc. via separate edges). For batch retrieval of full envelopes, consider writing a single multi-edge Gizmo script — but the per-call cost is sub-millisecond, so default is fine.
