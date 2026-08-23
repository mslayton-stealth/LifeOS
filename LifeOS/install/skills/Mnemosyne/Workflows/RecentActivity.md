# Workflow: Recent Activity (Catch-Up Primitive)

When a session resumes, when you're spawned as a subagent, or when the user asks "what's been going on" — call `recent_activity` BEFORE asking them to re-explain. The graph self-describes its own change history.

## The contract

Every write through `assert_node`, `assert_edge`, `task_create`, and `task_update` stamps `/epistemology/edge/written_at` on the touched subjects with an ISO-8601 UTC timestamp. `recent_activity(since=...)` returns subjects with `max(written_at) > since`, newest first.

## Call shape

```
mcp__mnemosyne__recent_activity(
  since="2026-05-25T00:00:00Z",
  scope="pai:project:foo",
  limit=20
)
```

| Parameter | Default | Notes |
|---|---|---|
| `since` | required | ISO-8601 UTC. Pass `1970-01-01T00:00:00Z` for "all touched ever". |
| `scope` | none | Restrict to a ContextScope. Pass `any` / omit for cross-scope. |
| `limit` | 50 | Max 500. Cap at 20–30 for normal catch-up. |

## Output shape

```json
{
  "since": "2026-05-25T00:00:00Z",
  "scope": "pai:project:foo",
  "count": 7,
  "activity": [
    { "node_id": "/pai/project/foo/finding/bar", "written_at": "2026-05-26T18:22:14Z" },
    ...
  ]
}
```

Each entry is `{node_id, written_at}`. No descriptions inline — fetch the envelope with `node(id)` for any entry that looks load-bearing.

## When to call

### Session resume (normal 24-hour catch-up)

```
recent_activity(since="<24h ago in ISO-8601>", limit=20)
```

24–48 hours is the normal `since` window. Widen if the user has been away longer.

### Spawned subagent

When you're spawned by an Algorithm or Delegation flow to work on something:

```
recent_activity(since="<work-session-start>", limit=10, scope="<work-scope>")
```

The work-session start is in the ISA frontmatter. Restrict to the work scope so you see only relevant changes.

### User asks "what's been happening"

```
recent_activity(since="<24h ago>", limit=30)
```

Skim the IDs. Group by scope. Summarize at the top — "7 things touched: 4 in pai:project:foo, 3 in pai:memory."

## Picking `since`

| User context | Reasonable `since` |
|---|---|
| Resuming after a few hours | 12h ago |
| Resuming next day | 24h ago |
| Resuming after a week | 7 days ago |
| Long absence | 30 days ago |
| "Everything ever touched" | `1970-01-01T00:00:00Z` |

For computing the timestamp:

```typescript
const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  .toISOString()
  .replace(/\.\d{3}Z$/, "Z");
```

In an MCP call from Claude, just write the literal ISO string from your current-time reasoning.

## What's NOT in the result

- **Pre-write nodes.** Anything written before `written_at` was added to the schema (`/epistemology/edge/written_at` is a substrate predicate, present from install) won't show up. For migrated content, the migration timestamp is the `written_at`.
- **File-only changes.** If the user edited a markdown file in `MEMORY/KNOWLEDGE/` but you haven't re-run migration, the graph doesn't know. Re-run migration or fall back to `git log -- MEMORY/KNOWLEDGE/`.
- **Read-only queries.** `query`, `node`, `list_by_*` don't update timestamps. Only writes count as activity.

## Composition with `node` and `query`

The catch-up loop:

1. `recent_activity(since=...)` → list of IDs.
2. For each ID that looks load-bearing, `node(id)` to read the envelope.
3. If the envelope suggests a cluster you should understand, `query(start_node=id, depth=1)` to see what changed around it.
4. Summarize to the user before asking what they want to do next.

## Anti-patterns

- **Skipping catch-up because "the user will tell me."** They might forget or assume you remember. Catch-up is one MCP call. Do it.
- **Setting `since="1970-01-01T00:00:00Z"` on every call** — defeats the point. Use it once for an audit; otherwise pick a meaningful window.
- **Calling `node()` on every returned ID.** Skim the IDs first. Most catch-up returns are noise (timestamp updates from related edges). Only fetch envelopes for the 2–3 that matter.
- **Confusing `written_at` with markdown mtime.** They're different. Graph activity, not file activity.
