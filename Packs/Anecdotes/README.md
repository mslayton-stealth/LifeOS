# Anecdotes

> Structured anecdote capture + retrieval on top of Mnemosyne. Every story is decomposed into setup / complication / resolution / insight, classified by modality and domain, and stored as graph nodes you can query by tag, contributor, or heuristic.

Anecdotes adds an opinionated overlay on Mnemosyne's substrate. Where Mnemosyne gives you nodes + edges with epistemic envelopes, Anecdotes gives you **case-based professional knowledge** as the unit of contribution: a discrete story carrying a portable heuristic.

**Prerequisite:** the [Mnemosyne pack](../Mnemosyne/) must be installed first. Anecdotes seeds its schema into the same Cayley instance and uses Mnemosyne's existing MCP tools (`query`, `node`, `list_by_scope`) for ad-hoc reads.

---

## What you get

- **Anecdotes schema** (`Schemas/anecdotes.nq`) — `Anecdote`, `AnecdoteModality` (dictated, reflective, curated, dialectic, interview), `Utterance` (for multi-speaker dialectic anecdotes), `Contributor`, `DomainExpertise`. Substrate predicates only — no billing, no licensing.
- **Extraction pipeline** — TS port of the LLM-proposes / human-validates flow. Two prompt templates (prose + dialectic), JSON parser tolerant of markdown fences, schema validator, deterministic quad generator.
- **CLI** (`Tools/AnecdotesCli.ts`) — five subcommands: `prompt` (generate extraction prompt), `ingest` (parse LLM response → quads), `seed` (load schema into running Cayley), `query` (filtered retrieval), `fetch-corpus` (download public-domain prototype texts from Project Gutenberg).
- **Skill at `~/.claude/skills/Anecdotes/`** — auto-activates when you mention anecdote capture, knowledge extraction, professional case studies, or domain-expert interviews.

---

## Data model

Every anecdote is the same four-part shape:

| Field | Purpose |
|---|---|
| `setup` | Situation — who, where, when, what was at stake |
| `complication` | What went wrong, was unexpected, or unknown |
| `resolution` | What was actually done and how it played out |
| `insight` | The portable heuristic the story teaches (`insight_explicit` flag tracks whether the original states it directly) |

Plus structural metadata: `title`, `modality`, `characters`, `tags`, `domains`, `source_excerpt`.

### Five modalities (drives parsing strategy)

| Modality | Description | Canonical example |
|---|---|---|
| `dictated` | Oral, transcribed, digressive — same story may re-enter from different angles | Twain's Autobiography |
| `reflective` | Written autobiography or memoir; moral often explicit | Franklin's Autobiography |
| `curated` | Polished narrative; insight often implicit, reader infers heuristic | Feynman's _Surely You're Joking_ |
| `dialectic` | Multi-speaker; insight emerges from dialogue — has ordered `Utterance` nodes | Knuth's _Surreal Numbers_ |
| `interview` | Live interview with a domain expert | Production target |

### Domain expertise (extensible)

Starter list ships with: `talent_agent`, `tour_management`, `lighting_design`, `sound_engineering`, `journalism`, `civic_life`, `physics`, `mathematics`. Add your own by extending `Schemas/anecdotes.nq`.

---

## Pipeline

```
text source (book, transcript, conversation)
    │
    ▼
bun AnecdotesCli.ts prompt chunk.txt   ←─── generates LLM extraction prompt
    │
    ▼
[paste prompt into Claude / GPT / local LLM, copy the JSON response]
    │
    ▼
bun AnecdotesCli.ts ingest response.json \
  --contributor /anecdote/contributor/franklin \
  --out quads.json
    │
    ▼
bun AnecdotesCli.ts write quads.json   ←─── POSTs to Cayley
    │
    ▼
Mnemosyne graph                       ←─── query via mcp__mnemosyne__*
                                            or via AnecdotesCli.ts query
```

The LLM round-trip is intentionally decoupled. v0 = manual paste, v1 = Anthropic SDK auto-call. The contract is JSON in, quads out — swap LLMs without touching downstream code.

---

## Idempotency

Anecdote IDs are SHA1-deterministic: `hash(contributor_slug | source_excerpt[:200])`. Re-running extraction on the same input produces the same node. Mnemosyne's `load.ignore_duplicates: true` swallows the repeat writes.

---

## Use the Mnemosyne MCP tools to query

Once anecdotes are in the graph, retrieval piggybacks on Mnemosyne's existing tools — no separate MCP server is needed:

```
mcp__mnemosyne__list_by_scope(scope="anecdotes:prototype", limit=50)
mcp__mnemosyne__query(start_node="/anecdote/contributor/franklin", depth=1)
mcp__mnemosyne__node(node_id="/anecdote/anecdote/franklin/the-water-american_abc123")
```

The Anecdotes CLI also wraps common queries (`query --by-tag foo`, `query --by-domain physics`) for one-shot terminal use.

---

## What's NOT in this prototype

- **No financial commons** — `ConsentTerms`, `UseEvent`, `ConsumerEntity`, payout addresses, and metering live in the private upstream stack. The prototype focuses on capture + retrieval; commercial licensing is a future layer.
- **No live LLM integration** — v0 ships the prompt + JSON round-trip as a manual flow. v1 will wire `bun TOOLS/Inference.ts` (PAI's existing inference helper) for auto-extraction.
- **No audio ingest** — interview-modality anecdotes assume you have a transcript already. STT (Whisper, etc.) is not in scope.
- **No FastMCP server** — read access is via the Mnemosyne MCP server already running on `127.0.0.1:64211`. Adding an Anecdotes-specific server would be redundant.

---

## Install

Point your DA at this directory:

```
"Install the Anecdotes pack from PAI/Packs/Anecdotes/"
```

The wizard checks for a running Mnemosyne first, then copies the skill, seeds the anecdotes schema into the existing Cayley, and optionally fetches the Project Gutenberg prototype corpus. Pre-reqs: Mnemosyne pack installed and Cayley running, Bun, an LLM you can hand prompts to.

---

## Files

| Path | Purpose |
|---|---|
| `src/SKILL.md` | Skill activator |
| `src/Workflows/CaptureAnecdote.md` | Prompt → LLM → validate → quads → write |
| `src/Workflows/QueryAnecdotes.md` | Filtered retrieval patterns |
| `src/Workflows/ReflectAcrossAnecdotes.md` | Cross-anecdote pattern mining |
| `src/References/Schema.md` | Full predicate + modality + domain vocabulary |
| `src/References/CorpusGuide.md` | Project Gutenberg prototype corpus pointers |
| `src/Schemas/anecdotes.nq` | Substrate schema (depends on Mnemosyne's epistemology + classifiers) |
| `src/Tools/CayleyClient.ts` | Slim HTTP wrapper (vendored from Mnemosyne) |
| `src/Tools/Prompts.ts` | EXTRACTION_PROMPT + DIALECTIC_PROMPT templates |
| `src/Tools/Extract.ts` | JSON parser + schema validator |
| `src/Tools/Quads.ts` | `buildAnecdoteQuads` + `buildContributorQuads` |
| `src/Tools/SeedSchema.ts` | Load anecdotes.nq into running Cayley |
| `src/Tools/AnecdotesCli.ts` | CLI: `prompt` / `ingest` / `write` / `query` / `fetch-corpus` |
