# Workflow: Migrate from Files

One-shot import of `~/.claude/PAI/MEMORY/KNOWLEDGE/**/*.md` into the graph. Run after install, after major KNOWLEDGE/ additions, or when you want the graph to reflect the markdown layer.

## Pre-conditions

- Cayley is running on `127.0.0.1:64210` (`bun ~/.claude/skills/Mnemosyne/Tools/StartLocal.ts` first if not).
- Substrate schemas are seeded (`bun ~/.claude/skills/Mnemosyne/Tools/SeedSchemas.ts`).
- `~/.claude/PAI/MEMORY/KNOWLEDGE/` exists with at least one `*.md` file.

## Running

```bash
bun ~/.claude/skills/Mnemosyne/Tools/MigrateKnowledge.ts
```

Default knowledge directory: `~/.claude/PAI/MEMORY/KNOWLEDGE/`. Default scope: `pai:knowledge`.

Options:

| Flag | Purpose |
|---|---|
| `--knowledge-dir <path>` | Override source directory |
| `--scope <scope>` | Override target scope (default `pai:knowledge`) |
| `--dry-run` | Parse + print counts; do not write to Cayley |
| `--verbose` | One log line per file |

## What gets imported

For each `*.md` file under `KNOWLEDGE/`:

| Markdown element | Graph result |
|---|---|
| File itself | A node at `/pai/knowledge/<bucket>/<slug>` |
| `entity_type` in frontmatter | Node's `node_type` (`/classifier/entity/agent/conscious` for `person`, `/classifier/entity/agent/collective` for `company`, etc.) |
| Directory name (People/Companies/Ideas/Research) | Fallback `entity_type` when frontmatter omits it |
| `name` / `title` in frontmatter | Node's `name` |
| `description` / `summary` in frontmatter | Node's `description` (truncated to 1000 chars) |
| `epistemic_state` in frontmatter | Node's `epistemic_state` (default `putative` if missing) |
| `tags` in frontmatter | Edges to `/pai/tag/<tag>` nodes via `/classifier/relationship/structural` |
| `[[wikilinks]]` in body | Edges to the resolved target via `/epistemology/edge/derives_from` |
| Always | `/epistemology/edge/justification_type` = testimonial; `/epistemology/edge/provenance` = relative path; `/epistemology/edge/written_at` = now |

## Wikilink resolution

The migrator builds a slug → node-ID index from all parsed files (case-insensitive, kebab-case). When a `[[link]]` matches an indexed file, the edge points to the real node. When it doesn't, the edge points to `/pai/knowledge/_unresolved/<slug>` — the target won't exist yet but the link is preserved. A future migration run will resolve it if you add the matching file.

## Idempotency

Re-running migration is safe:

- Cayley's `load.ignore_duplicates: true` drops duplicate quads.
- Edge instance IDs are SHA1-deterministic, so re-asserting the same `(subject, predicate, object)` is a no-op.
- `written_at` updates on each run — `recent_activity` will show the migrated nodes as "touched" each time. If you want a quiet re-run, edit the script to skip `written_at` updates for unchanged content (currently always updated, by design — re-migration IS a touch).

## Anti-patterns

- **Running migration with a custom `--scope` then querying the default.** Pick one scope per knowledge slice and stick with it. Mixed scopes fragment the graph.
- **Editing markdown then asserting via `assert_node` instead of re-migrating.** The file is now the source of truth — re-migrate. Don't double-write.
- **Migrating non-KNOWLEDGE/ directories.** WORK/ has ISAs (use the ISA skill's mirroring path instead), LEARNING/ has signals (different semantics — they're failures, not knowledge). KNOWLEDGE/ is the right input.
- **Expecting the graph to track markdown deletions.** Migration is additive. If you delete a file, the corresponding graph node still exists. Garbage-collect manually with a Cayley delete, or accept that the graph is append-mostly.

## What this isn't

This is a one-shot import. There is **no** filesystem watcher that auto-syncs markdown to graph. If you want sync on save, add a hook (`PostToolUse` matching `Write|Edit`) that calls `MigrateKnowledge.ts --knowledge-dir <path-to-changed-file>` — or just re-run periodically (it's idempotent and fast).
