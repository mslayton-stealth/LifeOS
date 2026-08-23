---
name: Anecdotes
description: Structured anecdote capture and retrieval on top of Mnemosyne. Decomposes every story into setup / complication / resolution / insight, classified by modality (dictated, reflective, curated, dialectic, interview) and domain expertise (talent_agent, tour_management, lighting_design, sound_engineering, journalism, civic_life, physics, mathematics, software_engineering). Stores anecdotes as graph nodes with contributors, tags, characters, and source_text provenance. Pipeline is LLM-proposes / human-validates — TypeScript CLI generates extraction prompts from text chunks, parses the JSON response, validates against the schema, builds Cayley quads with deterministic SHA1 IDs (idempotent), and writes through Mnemosyne's existing Cayley instance. No new MCP server — reads piggyback on Mnemosyne's query / node / list_by_scope tools. Substrate-only: this prototype omits the financial commons layer (ConsentTerms, UseEvent, ConsumerEntity, payouts) that lives in the upstream private stack. Default scope is anecdotes:prototype. Project Gutenberg fetch helper for Franklin and Twain autobiographies as a test corpus. USE WHEN anecdote, capture story, extract heuristic, professional case knowledge, interview transcript, domain expert story, story library, narrative knowledge, lessons learned from stories, knowledge graph from autobiography, Franklin, Twain, Feynman, Knuth, setup complication resolution insight, dialectic anecdote, multi-speaker utterance, contributor, retrieve anecdotes by tag, retrieve anecdotes by domain.
---

# Anecdotes

Structured anecdote capture and retrieval on top of Mnemosyne. Every anecdote = a discrete story carrying a portable heuristic, decomposed into the same four-part shape so it's queryable.

## When to use

- The user shares a story worth preserving — "here's what happened when..."
- You're processing a transcript, podcast, book chapter, or interview.
- The user asks "what stories do we have about X?" or "what have we learned about Y from past cases?"
- You're building a domain-expertise library from a corpus.
- You want to cross-reference: "which contributors gave us anecdotes tagged Z?"

## When NOT to use

- Plain note-taking — use Mnemosyne's `assert_node` directly, no need for the anecdote shape.
- Real-time conversation summarization — anecdotes are for stories with heuristics, not generic logs.
- The user is editing a single existing anecdote — read the source_text, edit upstream, re-ingest.
- Mnemosyne isn't running — boot it first: `bun ~/.claude/skills/Mnemosyne/Tools/StartLocal.ts`.

## The four-part shape

Every anecdote has this skeleton:

| Field | What to capture |
|---|---|
| `setup` | Who, where, when, what's at stake. 1–3 sentences. |
| `complication` | What went wrong, was unexpected, or unknown. 1–3 sentences. |
| `resolution` | What was actually done and how it played out. 1–3 sentences. |
| `insight` | The portable heuristic. 1–3 sentences. Mark `insight_explicit=true` if the source states it directly; `false` if you inferred it. |

Plus structural metadata: `title`, `modality`, `characters`, `tags`, `domains`, `source_excerpt` (shortest verbatim substring containing the core).

## Five modalities (drives parsing)

| Modality | Use when |
|---|---|
| `dictated` | Oral, transcribed, sometimes digressive (Twain Autobiography) |
| `reflective` | Written autobiography or memoir, moral often explicit (Franklin) |
| `curated` | Polished personal narrative, insight implicit (Feynman) |
| `dialectic` | Multi-speaker dialogue — has ordered `Utterance` nodes (Knuth Surreal Numbers) |
| `interview` | Live interview transcript with a domain expert |

## Pipeline (LLM-proposes / human-validates)

```
text source
    │
    ▼ bun AnecdotesCli.ts prompt source.txt > prompt.txt
LLM extraction prompt
    │
    ▼ [user pastes into Claude/GPT/local LLM]
JSON candidate list
    │
    ▼ bun AnecdotesCli.ts ingest response.json --contributor /anecdote/contributor/X --out quads.json
Cayley quads
    │
    ▼ bun AnecdotesCli.ts write quads.json
Mnemosyne graph
    │
    ▼ mcp__mnemosyne__query / list_by_scope / node
results
```

The LLM round-trip is decoupled on purpose — paste anywhere, swap models, no SDK coupling.

## CLI tool quickreference

```bash
# 1. Generate extraction prompt
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts prompt corpus/chunk.txt > /tmp/prompt.txt

# 2. (Manual) feed prompt to an LLM, save response JSON to /tmp/resp.json

# 3. Validate + build quads (does NOT write yet — inspect first)
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts ingest /tmp/resp.json \
  --contributor /anecdote/contributor/franklin \
  --create-contributor --contributor-name 'Benjamin Franklin' --contributor-status historical \
  --scope anecdotes:prototype \
  --out /tmp/quads.json

# 4. Write quads to Cayley
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts write /tmp/quads.json

# Or skip 3+4 — pipe straight in
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts ingest /tmp/resp.json \
  --contributor /anecdote/contributor/franklin --write

# 5. Query
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-tag patience
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-domain physics
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-contributor /anecdote/contributor/franklin

# 6. Fetch Gutenberg prototype corpus
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts fetch-corpus --out ~/.claude/PAI/MEMORY/CORPUS/anecdotes
```

## Reading anecdotes from Claude Code

Use Mnemosyne's MCP tools — no separate `mcp__anecdotes__*` exists:

```
mcp__mnemosyne__list_by_scope(scope="anecdotes:prototype", limit=20)
mcp__mnemosyne__query(start_node="/anecdote/contributor/franklin", depth=1)
mcp__mnemosyne__node(node_id="/anecdote/anecdote/franklin/<slug>_<hash>")
```

The dialectic-modality anecdotes have ordered `Utterance` child nodes:

```
mcp__mnemosyne__query(start_node="/anecdote/anecdote/.../the-dialectic-one_xyz", depth=1)
# → returns the anecdote + its utterance children with speaker/ordinal/text
```

## Idempotency

Anecdote node IDs are `hash(contributor_slug | source_excerpt[:200])`. Re-running extraction on the same input produces the same node. Re-runs are safe — Cayley drops duplicate quads.

## Anti-patterns

- **Capturing the same story across multiple modalities.** Pick one based on the source form. If the source is a transcript, it's `interview`; if a memoir, `reflective`; etc.
- **Inferring an `insight` and marking `insight_explicit=true`.** The flag is honest — if you supplied the heuristic, mark it `false`.
- **Tags as taxonomy.** Tags are keywords for retrieval. Use `domains` for the taxonomy axis. Tags overlap freely; domains are the closed list.
- **One node per quote.** A story is the unit, not a sentence. If you find yourself making many tiny anecdotes from one paragraph, you're slicing too finely.
- **Writing without `source_excerpt`.** Verbatim source is the verification trail. Future-you will need it.

## See also

- `Workflows/CaptureAnecdote.md` — end-to-end extraction recipe
- `Workflows/QueryAnecdotes.md` — filtered retrieval patterns
- `Workflows/ReflectAcrossAnecdotes.md` — cross-anecdote pattern mining
- `References/Schema.md` — full vocabulary
- `References/CorpusGuide.md` — Project Gutenberg prototype corpus
