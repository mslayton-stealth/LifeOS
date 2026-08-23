# Corpus Guide

Pointers to public-domain texts that work well as a prototype corpus. All sources are Project Gutenberg or other unambiguously public-domain locations.

The `fetch-corpus` subcommand of `AnecdotesCli.ts` knows about Franklin and Twain. Adding sources is a 3-line edit (see "Extending the corpus" below).

## Built-in sources

| Author | Modality | Source | Project Gutenberg # | Notes |
|---|---|---|---|---|
| Benjamin Franklin | reflective | Autobiography | 148 | The canonical reflective text. Insights are often explicit ("Have a definite purpose..."). |
| Mark Twain | dictated | Chapters from My Autobiography (NAR serialization) | 19987 | Public-domain selections from Twain's dictated autobiography, published in North American Review. Digressive; best stories scattered. |

To fetch:

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts fetch-corpus \
  --out ~/.claude/PAI/MEMORY/CORPUS/anecdotes
```

Files land at `~/.claude/PAI/MEMORY/CORPUS/anecdotes/{franklin,twain}/raw/<filename>.txt`.

## Recommended copyrighted sources (NOT downloaded automatically)

These are widely cited as canonical examples of their modality but remain under copyright. The upstream private stack used these under a fair-use research basis — **do not download or redistribute** in your install unless you have appropriate rights:

| Author | Modality | Title | Notes |
|---|---|---|---|
| Richard Feynman | curated | _Surely You're Joking, Mr. Feynman!_ | Polished personal narrative; insights almost always implicit |
| Donald Knuth | dialectic | _Surreal Numbers_ | Multi-speaker (Alice + Bill) knowledge construction; insight emerges from dialogue |

If you have legal access to these texts, supply them yourself in `~/.claude/PAI/MEMORY/CORPUS/anecdotes/<author>/raw/`. The extraction pipeline doesn't care about source.

## Chunking guide

Most LLM extraction prompts work best on chunks of:

- **Prose (reflective, curated):** 1–3 pages, ~600–1500 words. Chapter sections are usually right-sized.
- **Dictated (Twain):** smaller chunks, ~500 words. Twain digresses — a 3-page chunk can contain 3 unrelated anecdotes that the LLM will run together.
- **Dialectic:** 30–100 turns per chunk. Knuth's chapters in Surreal Numbers each form one or two arcs.
- **Interview:** one Q&A pair per chunk if structured; one ~5-min segment if continuous.

The `fetch-corpus` command downloads raw files but does NOT chunk. Chunk with whatever you prefer — `split`, `awk`, or a chapter-aware splitter. Example for Franklin:

```bash
# Split on lines that start "CHAPTER " (Project Gutenberg convention)
awk '/^CHAPTER / {n++; close(out); out=sprintf("chapter-%02d.txt", n)} {print > out}' \
  ~/.claude/PAI/MEMORY/CORPUS/anecdotes/franklin/raw/pg148.txt
```

## Domain coverage of built-in corpus

| Author | Likely domains |
|---|---|
| Franklin | civic_life, journalism, talent_agent (publishing), other |
| Twain | journalism, civic_life, other |
| Feynman | physics, mathematics, other |
| Knuth | mathematics, software_engineering, other |

The LLM's `domains` field on each candidate may differ from these — re-prompt if it's miscategorizing.

## Extending the corpus

### Add a new built-in source

Edit `~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts`, find the `CORPUS_SOURCES` array, add an entry:

```typescript
const CORPUS_SOURCES = [
  { slug: "franklin", url: "https://www.gutenberg.org/files/148/148-0.txt", filename: "pg148.txt" },
  { slug: "twain", url: "https://www.gutenberg.org/cache/epub/19987/pg19987.txt", filename: "pg19987.txt" },
  // Add yours:
  { slug: "your-author", url: "https://...", filename: "...txt" },
];
```

Then re-run `fetch-corpus`.

### Provide your own source

Drop any plain-text file under `~/.claude/PAI/MEMORY/CORPUS/anecdotes/<author-slug>/raw/`. The extraction pipeline works on any text.

For non-public-domain sources (your own writing, interview transcripts you own, etc.), there's no consent layer in this prototype — be deliberate about what you commit to a shared graph. If you need licensing tracking, that's the future commons layer.

## Legal note

Project Gutenberg texts are public-domain in the US but may have residual restrictions elsewhere. Re-check before redistribution. The `fetch-corpus` tool downloads for personal use only; it does not republish.
