# Anecdotes v1.0.0 — Installation Guide

**This guide is designed for AI agents installing this pack into a user's infrastructure.**

**Prerequisite:** the Mnemosyne pack must already be installed and Cayley must be running. If `~/.claude/skills/Mnemosyne/` is missing or Cayley is not reachable on `$CAYLEY_BASE_URL`, abort and tell the user to install Mnemosyne first.

---

## AI Agent Instructions

Use Claude Code's native tools to guide the user:

1. **AskUserQuestion** — for decisions
2. **TodoWrite** — for progress tracking
3. **Bash / Read / Write** — for installation
4. **VERIFY.md** — for validation

### Welcome Message

```
"I'm installing Anecdotes v1.0.0 — structured anecdote capture + retrieval
on top of Mnemosyne.

This pack adds:
- Anecdotes schema (Anecdote, Modality, Utterance, Contributor, Domain) seeded
  into the existing Mnemosyne Cayley
- TypeScript CLI for the LLM-extraction pipeline
- 3 workflow guides + 2 reference docs
- Skill at ~/.claude/skills/Anecdotes/ that auto-activates for anecdote work

Prerequisite: Mnemosyne pack installed and Cayley running.

Let me check your system."
```

---

## Phase 1: System Analysis

```bash
CLAUDE_DIR="$HOME/.claude"

# Mnemosyne installed?
if [ -d "$CLAUDE_DIR/skills/Mnemosyne" ]; then
  echo "OK Mnemosyne skill found"
else
  echo "ERROR Mnemosyne pack required — install Packs/Mnemosyne first, then retry"
  exit 1
fi

# Cayley reachable?
CAYLEY_URL="${CAYLEY_BASE_URL:-http://localhost:64211}"
if curl -sf -X POST -d 'g.Vertex().GetLimit(1)' "$CAYLEY_URL/api/v1/query/gizmo" >/dev/null; then
  echo "OK Cayley reachable at $CAYLEY_URL"
else
  echo "ERROR Cayley not reachable at $CAYLEY_URL"
  echo "  Start it: bun $CLAUDE_DIR/skills/Mnemosyne/Tools/StartLocal.ts"
  exit 1
fi

# Mnemosyne substrate present?
for node in /epistemology/verified /classifier/entity; do
  if curl -sf -X POST -d "g.V(\"$node\").Out().GetLimit(1)" "$CAYLEY_URL/api/v1/query/gizmo" | grep -q '"id"'; then
    echo "OK substrate anchor present: $node"
  else
    echo "ERROR Mnemosyne substrate not seeded — run: bun $CLAUDE_DIR/skills/Mnemosyne/Tools/SeedSchemas.ts"
    exit 1
  fi
done

# Anecdotes already installed?
if [ -d "$CLAUDE_DIR/skills/Anecdotes" ]; then
  echo "WARNING Existing Anecdotes skill found"
  ls "$CLAUDE_DIR/skills/Anecdotes/" 2>/dev/null | head -5
else
  echo "OK No existing Anecdotes skill (clean install)"
fi

# Bun
command -v bun >/dev/null 2>&1 && echo "OK bun: $(bun --version)" || echo "ERROR bun required"
```

---

## Phase 2: User Questions

### Question 1: Conflict resolution (if existing skill found)

```json
{
  "header": "Conflict — Existing Anecdotes",
  "question": "An existing Anecdotes skill was found. How should I proceed?",
  "multiSelect": false,
  "options": [
    {"label": "Backup and Replace (Recommended)", "description": "Timestamped backup, then install fresh"},
    {"label": "Replace Without Backup", "description": "Remove existing, install fresh"},
    {"label": "Abort", "description": "Keep existing"}
  ]
}
```

### Question 2: Fetch the prototype corpus

```json
{
  "header": "Prototype corpus",
  "question": "Download the public-domain Project Gutenberg prototype corpus (Franklin + Twain autobiographies, ~1.5MB)?",
  "multiSelect": false,
  "options": [
    {"label": "Yes, download to ~/.claude/PAI/MEMORY/CORPUS/anecdotes/ (Recommended)", "description": "Pulls Franklin Autobiography (PG #148) and Twain Autobiography v1 (PG #8525). Useful for testing the extraction pipeline."},
    {"label": "Skip — I'll provide my own source texts", "description": "Install schema + tools only; bring your own corpora."}
  ]
}
```

### Question 3: Final confirmation

```json
{
  "header": "Install Anecdotes",
  "question": "Ready to install Anecdotes v1.0.0?",
  "multiSelect": false,
  "options": [
    {"label": "Yes, install now (Recommended)", "description": "Copy skill, bun install, seed schema into existing Cayley, optionally fetch corpus"},
    {"label": "Show me what will change", "description": "List files + Cayley writes"},
    {"label": "Cancel", "description": "Abort"}
  ]
}
```

**If user chose "Show me what will change":**

```
"Directories created:
- ~/.claude/skills/Anecdotes/  (skill source)
- ~/.claude/PAI/MEMORY/CORPUS/anecdotes/  (only if corpus download chosen)

Files created:
- ~/.claude/skills/Anecdotes/SKILL.md
- ~/.claude/skills/Anecdotes/Workflows/{CaptureAnecdote,QueryAnecdotes,ReflectAcrossAnecdotes}.md
- ~/.claude/skills/Anecdotes/References/{Schema,CorpusGuide}.md
- ~/.claude/skills/Anecdotes/Schemas/anecdotes.nq
- ~/.claude/skills/Anecdotes/Tools/{CayleyClient,Prompts,Extract,Quads,SeedSchema,AnecdotesCli}.ts
- ~/.claude/skills/Anecdotes/package.json + tsconfig.json

Cayley writes (into the existing Mnemosyne graph):
- ~130 quads from anecdotes.nq (types, modalities, domains, edges, scope)

Mnemosyne settings.json is NOT modified. No new MCP server is added.
Anecdotes uses Mnemosyne's existing MCP server for reads via the standard
graph tools (query, node, list_by_scope)."
```

---

## Phase 3: Backup (if needed)

```bash
CLAUDE_DIR="$HOME/.claude"
BACKUP_DIR="$CLAUDE_DIR/backups/anecdotes-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [ -d "$CLAUDE_DIR/skills/Anecdotes" ]; then
  cp -r "$CLAUDE_DIR/skills/Anecdotes" "$BACKUP_DIR/skill"
  echo "Backup at: $BACKUP_DIR"
fi
```

---

## Phase 4: Installation

```json
{
  "todos": [
    {"content": "Copy skill files", "status": "pending", "activeForm": "Copying skill files"},
    {"content": "Install bun deps", "status": "pending", "activeForm": "Installing bun deps"},
    {"content": "Seed anecdotes schema", "status": "pending", "activeForm": "Seeding schema"},
    {"content": "Fetch corpus (if requested)", "status": "pending", "activeForm": "Fetching corpus"},
    {"content": "Run verification", "status": "pending", "activeForm": "Verifying"}
  ]
}
```

### 4.1 Copy skill files

```bash
CLAUDE_DIR="$HOME/.claude"
PACK_DIR="$(pwd)"
mkdir -p "$CLAUDE_DIR/skills/Anecdotes"
cp -r "$PACK_DIR/src/." "$CLAUDE_DIR/skills/Anecdotes/"
echo "OK skill source copied"
```

### 4.2 Bun install

```bash
cd "$CLAUDE_DIR/skills/Anecdotes" && bun install
```

This pack has no runtime npm deps beyond Bun's built-ins (uses native `fetch`, `node:crypto`, `node:fs`). `bun install` resolves only the dev `@types/bun` for typecheck.

### 4.3 Seed the anecdotes schema

```bash
CLAUDE_DIR="$HOME/.claude"
CAYLEY_BASE_URL="${CAYLEY_BASE_URL:-http://localhost:64211}" \
  bun "$CLAUDE_DIR/skills/Anecdotes/Tools/SeedSchema.ts"
```

Idempotent — Cayley's `load.ignore_duplicates: true` swallows repeated quads.

### 4.4 Fetch corpus (if requested)

```bash
CLAUDE_DIR="$HOME/.claude"
CORPUS_DIR="$CLAUDE_DIR/PAI/MEMORY/CORPUS/anecdotes"
mkdir -p "$CORPUS_DIR"
bun "$CLAUDE_DIR/skills/Anecdotes/Tools/AnecdotesCli.ts" fetch-corpus --out "$CORPUS_DIR"
echo "Corpus at: $CORPUS_DIR"
```

---

## Phase 5: Verification

Run VERIFY.md checks. Summary:

```bash
CLAUDE_DIR="$HOME/.claude"
CAYLEY_URL="${CAYLEY_BASE_URL:-http://localhost:64211}"

# Schema anchor nodes
for node in /anecdote/anecdote /anecdote/modality/dictated /anecdote/modality/dialectic \
            /anecdote/contributor /anecdote/domain/talent_agent /anecdote/utterance \
            /epistemology/scope/anecdotes_prototype; do
  if curl -sf -X POST -d "g.V(\"$node\").Out().GetLimit(1)" \
       "$CAYLEY_URL/api/v1/query/gizmo" | grep -q '"id"'; then
    echo "OK $node"
  else
    echo "MISSING $node"
  fi
done

# CLI smoke test — prompt generation
echo "Hello, world. This is a test paragraph." > /tmp/anecdotes-smoke.txt
bun "$CLAUDE_DIR/skills/Anecdotes/Tools/AnecdotesCli.ts" prompt /tmp/anecdotes-smoke.txt \
  | head -5 | grep -q "anecdote extractor" \
  && echo "OK prompt command works" || echo "ERROR prompt command failed"
rm -f /tmp/anecdotes-smoke.txt
```

---

## Success / Failure Messages

### On Success

```
"Anecdotes v1.0.0 installed.

The schema is in your Mnemosyne graph at $CAYLEY_BASE_URL. The skill is at
~/.claude/skills/Anecdotes/.

Try the pipeline against any text:

  # 1. Generate extraction prompt
  bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts prompt \
    ~/.claude/PAI/MEMORY/CORPUS/anecdotes/franklin.txt > /tmp/prompt.txt

  # 2. Paste /tmp/prompt.txt into Claude / GPT, capture JSON to /tmp/resp.json

  # 3. Convert to quads + write to Cayley
  bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts ingest /tmp/resp.json \
    --contributor /anecdote/contributor/franklin \
    --create-contributor --contributor-name 'Benjamin Franklin' \
    --out /tmp/quads.json
  bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts write /tmp/quads.json

  # 4. Query
  bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --by-domain physics

Or from any Claude Code session (Mnemosyne MCP):
  mcp__mnemosyne__list_by_scope(scope='anecdotes:prototype', limit=20)"
```

### On Failure

```
"Installation hit issues. Check:

1. Mnemosyne installed: ls ~/.claude/skills/Mnemosyne/
2. Cayley running: curl http://localhost:64211/api/v1/query/gizmo -X POST -d 'g.Vertex().GetLimit(1)'
3. Substrate seeded: bun ~/.claude/skills/Mnemosyne/Tools/SeedSchemas.ts
4. Anecdotes deps: cd ~/.claude/skills/Anecdotes && bun install"
```

---

## What's Included

| Path | Purpose |
|---|---|
| `src/SKILL.md` | Skill activator |
| `src/Workflows/CaptureAnecdote.md` | Prompt → LLM → validate → write |
| `src/Workflows/QueryAnecdotes.md` | Filtered retrieval patterns |
| `src/Workflows/ReflectAcrossAnecdotes.md` | Cross-anecdote pattern mining |
| `src/References/Schema.md` | Full vocabulary reference |
| `src/References/CorpusGuide.md` | Project Gutenberg pointers |
| `src/Schemas/anecdotes.nq` | Substrate schema |
| `src/Tools/CayleyClient.ts` | Slim HTTP wrapper |
| `src/Tools/Prompts.ts` | Extraction prompt templates |
| `src/Tools/Extract.ts` | JSON parser + validator |
| `src/Tools/Quads.ts` | Quad builders |
| `src/Tools/SeedSchema.ts` | Schema loader |
| `src/Tools/AnecdotesCli.ts` | Multi-command CLI |
