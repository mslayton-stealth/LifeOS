# Workflow: Capture an Anecdote

End-to-end recipe for getting a story from a source text into the Mnemosyne graph as a structured anecdote.

## Prerequisites

- Mnemosyne pack installed and Cayley running at `$CAYLEY_BASE_URL`
- Anecdotes pack installed, schema seeded
- A source text — book chapter, transcript, conversation log, paragraph

## Step 1: Pick the modality

Look at the source form, not the content. The modality determines which extraction prompt to use:

| Form | Modality |
|---|---|
| Spoken narration, transcribed (interview, podcast) | `dictated` or `interview` |
| Written memoir or autobiography | `reflective` |
| Polished essay, blog post, magazine piece | `curated` |
| Multi-speaker dialogue with knowledge construction | `dialectic` |

Mixed sources: pick the dominant form. A book that has dialogue stretches mostly uses `reflective` or `curated`; switch to `dialectic` only when the entire arc is the dialogue.

## Step 2: Chunk the source

Keep chunks small enough that the LLM can hold the full context — 1–5 pages of prose, or 50–200 dialogue turns. Too-large chunks dilute extraction quality; too-small ones lose context that makes an anecdote coherent.

For Project Gutenberg-style texts: split on chapter boundaries first, then by section if chapters are huge.

## Step 3: Generate the extraction prompt

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts prompt path/to/chunk.txt > /tmp/prompt.txt
```

For dialectic chunks, add `--dialectic`:

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts prompt path/to/dialogue.txt --dialectic > /tmp/prompt.txt
```

## Step 4: Run the prompt against an LLM

Open the prompt in any LLM tool (Claude, GPT, local Llama, whatever):

```bash
cat /tmp/prompt.txt | pbcopy   # macOS — paste into web Claude/GPT
# or
cat /tmp/prompt.txt            # paste into your terminal LLM
```

The LLM should return a JSON array — possibly with markdown fences or leading prose (the parser strips both).

Save the response:

```bash
pbpaste > /tmp/resp.json       # macOS, after copying from the LLM
```

## Step 5: Ensure the contributor exists

Anecdotes need a `Contributor` node. If you haven't created one for this author yet:

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts ingest /tmp/resp.json \
  --contributor /anecdote/contributor/franklin \
  --create-contributor \
  --contributor-name 'Benjamin Franklin' \
  --contributor-status historical \
  --scope anecdotes:prototype \
  --out /tmp/quads.json
```

`--create-contributor` emits Contributor quads alongside the anecdote quads. Skip the flag on subsequent runs — the contributor only needs to be created once. Cayley deduplicates either way (idempotent), but it's cleaner to omit.

Status options:

- `active` — living person, currently contributing
- `historical` — public-domain corpus (Franklin, Twain, etc.)
- `withdrawn` — opted out; preserved for provenance

## Step 6: Inspect the quads

Before writing, look at what you're about to commit:

```bash
jq 'length' /tmp/quads.json                                     # total quad count
jq '[.[] | select(.predicate == "/type/object/type" and .object == "/anecdote/anecdote")] | length' /tmp/quads.json  # anecdote count
jq '.[] | select(.predicate == "/anecdote/anecdote/insight") | .object' /tmp/quads.json  # all insights
```

If the count looks off, inspect the LLM response and re-prompt with adjustments.

## Step 7: Write to Cayley

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts write /tmp/quads.json
```

Or — skip the intermediate file and write inline:

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts ingest /tmp/resp.json \
  --contributor /anecdote/contributor/franklin --write
```

The `--write` flag posts quads directly to Cayley after build.

## Step 8: Verify

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query \
  --by-contributor /anecdote/contributor/franklin --limit 10
```

Or via Mnemosyne MCP:

```
mcp__mnemosyne__query(start_node="/anecdote/contributor/franklin", depth=1)
```

## Patterns for repeated work

### Batch a whole corpus

```bash
for chunk in ~/.claude/PAI/MEMORY/CORPUS/anecdotes/franklin/chunk_*.txt; do
  bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts prompt "$chunk" > /tmp/prompt.txt
  # (manual LLM step or scripted via an inference helper)
  # ... obtain /tmp/resp.json ...
  bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts ingest /tmp/resp.json \
    --contributor /anecdote/contributor/franklin --write
done
```

### Auto-LLM (when you have PAI's Inference.ts available)

Pipe the prompt through PAI's existing inference helper (in v5.0.0 releases):

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts prompt chunk.txt \
  | bun ~/.claude/PAI/TOOLS/Inference.ts standard \
  > /tmp/resp.json
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts ingest /tmp/resp.json \
  --contributor /anecdote/contributor/X --write
```

(Future v1 of this pack will wire this end-to-end; v0 keeps the LLM call manual.)

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| "LLM response is not valid JSON" | Model returned prose instead of an array | Re-prompt with stricter "JSON only" instruction; ensure your model is in JSON-mode if available |
| "missing required fields" | LLM dropped fields | Re-prompt and explicitly enumerate the required keys; check the prompt didn't get truncated |
| "unknown modality" | LLM hallucinated a modality not in the closed list | Re-prompt; the closed list is in `References/Schema.md` |
| "dialectic candidates require non-empty utterances list" | Used dialectic modality without supplying ordered turns | Either switch modality or supply utterances |
| Quads written but `query --by-contributor` returns nothing | Wrong contributor ID | Verify with `mcp__mnemosyne__node(node_id=/anecdote/contributor/X)`; the contributor must exist before anecdotes can edge into it |
