# Mnemosyne v1.0.0 — Installation Guide

**This guide is designed for AI agents installing this pack into a user's infrastructure.**

---

## AI Agent Instructions

**This is a wizard-style installation.** Use Claude Code's native tools to guide the user through installation:

1. **AskUserQuestion** — for user decisions and confirmations
2. **TodoWrite** — for progress tracking
3. **Bash / Read / Write** — for actual installation
4. **VERIFY.md** — for final validation

### Welcome Message

Before starting, greet the user:

```
"I'm installing Mnemosyne v1.0.0 — a graph-DB memory layer for PAI.

This pack adds:
- Local Cayley graph database (BoltDB-backed, single file at ~/.claude/PAI/MEMORY/GRAPH/)
- MCP server (mnemosyne) exposing 13 graph + coordination tools to Claude Code
- Substrate schemas (epistemology + classifiers + scopes) — 386 quads
- One-shot migration tool to import existing MEMORY/KNOWLEDGE/ markdown into the graph
- Skill at ~/.claude/skills/Mnemosyne/ that auto-activates for graph queries

It does NOT replace your existing MEMORY/ — it adds a graph index alongside it.
The Cayley database is regeneratable; markdown stays the source of truth.

Let me analyze your system and guide you through installation."
```

---

## Phase 1: System Analysis

**Execute this analysis BEFORE any file operations.**

### 1.1 Run These Commands

```bash
CLAUDE_DIR="$HOME/.claude"
echo "Claude directory: $CLAUDE_DIR"

# Check skills directory
if [ -d "$CLAUDE_DIR/skills" ]; then
  echo "OK Skills directory exists at: $CLAUDE_DIR/skills"
else
  echo "INFO Skills directory does not exist (will be created)"
fi

# Check for existing Mnemosyne skill
if [ -d "$CLAUDE_DIR/skills/Mnemosyne" ]; then
  echo "WARNING Existing Mnemosyne skill found at: $CLAUDE_DIR/skills/Mnemosyne"
  ls -la "$CLAUDE_DIR/skills/Mnemosyne/" 2>/dev/null
else
  echo "OK No existing Mnemosyne skill (clean install)"
fi

# Check for PAI infrastructure
if [ -d "$CLAUDE_DIR/PAI/MEMORY" ]; then
  echo "OK PAI MEMORY/ exists at: $CLAUDE_DIR/PAI/MEMORY"
  if [ -d "$CLAUDE_DIR/PAI/MEMORY/KNOWLEDGE" ]; then
    KNOWLEDGE_COUNT=$(find "$CLAUDE_DIR/PAI/MEMORY/KNOWLEDGE" -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "OK KNOWLEDGE/ contains $KNOWLEDGE_COUNT markdown files (migration candidates)"
  else
    echo "INFO KNOWLEDGE/ not found — migration will be skipped"
  fi
else
  echo "INFO PAI MEMORY/ not found — graph will start empty"
fi

# Graph directory
if [ -d "$CLAUDE_DIR/PAI/MEMORY/GRAPH" ]; then
  echo "WARNING GRAPH/ directory already exists — will preserve unless user opts to reset"
  ls "$CLAUDE_DIR/PAI/MEMORY/GRAPH/" 2>/dev/null
else
  echo "OK No existing GRAPH/ directory (will be created)"
fi

# Bun
if command -v bun >/dev/null 2>&1; then
  echo "OK bun is available ($(bun --version))"
else
  echo "ERROR bun not found — required for MCP server. Install: curl -fsSL https://bun.sh/install | bash"
fi

# Cayley binary
if command -v cayley >/dev/null 2>&1; then
  echo "OK cayley binary is available ($(cayley version 2>&1 | head -1))"
else
  echo "INFO cayley not found"
  if command -v brew >/dev/null 2>&1; then
    echo "  Homebrew is available — installer can run: brew install cayley"
  else
    case "$(uname -s)" in
      Darwin) echo "  No Homebrew — see https://github.com/cayleygraph/cayley/releases for macOS binary" ;;
      Linux)  echo "  No Homebrew — see https://github.com/cayleygraph/cayley/releases for Linux binary" ;;
      *)      echo "  Unsupported platform: $(uname -s)" ;;
    esac
  fi
fi

# settings.json (for MCP registration)
if [ -f "$CLAUDE_DIR/settings.json" ]; then
  echo "OK settings.json exists (will register mnemosyne MCP server here)"
else
  echo "INFO settings.json not found — will be created"
fi

# Port 64210 availability
if lsof -iTCP:64210 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "WARNING Port 64210 is already in use — Cayley may conflict"
  lsof -iTCP:64210 -sTCP:LISTEN 2>/dev/null | head -3
else
  echo "OK Port 64210 is free"
fi
```

### 1.2 Present Findings

Tell the user what you found:

```
"Here's what I found on your system:
- Skills directory: [exists / will be created]
- Existing Mnemosyne skill: [found — will ask about conflict / not found]
- PAI MEMORY/: [found / not found]
- KNOWLEDGE/ files for migration: [N files / none]
- Existing GRAPH/: [found — preserve or reset / none]
- bun runtime: [found / MISSING — must install before proceeding]
- cayley binary: [found / will install via brew / manual install needed]
- settings.json: [found / will be created]
- Port 64210: [free / OCCUPIED]

[If bun missing]: STOP. Install bun first: curl -fsSL https://bun.sh/install | bash
[If port 64210 occupied]: ASK USER. Either stop the other process or change Cayley port.
[If cayley missing + no brew]: link to releases page and pause."
```

---

## Phase 2: User Questions

**Use AskUserQuestion at each decision point.**

### Question 1: Conflict Resolution (if existing skill found)

```json
{
  "header": "Conflict — Existing Mnemosyne",
  "question": "An existing Mnemosyne skill was found. How should I proceed?",
  "multiSelect": false,
  "options": [
    {"label": "Backup and Replace (Recommended)", "description": "Creates timestamped backup of existing skill directory, then installs new version"},
    {"label": "Replace Without Backup", "description": "Removes existing skill directory and installs fresh"},
    {"label": "Abort Installation", "description": "Cancel installation, keep existing skill"}
  ]
}
```

### Question 2: Cayley Install (if not present)

```json
{
  "header": "Install Cayley",
  "question": "Cayley graph database is not installed. How should I install it?",
  "multiSelect": false,
  "options": [
    {"label": "Install via Homebrew (Recommended)", "description": "Runs: brew install cayley. macOS only."},
    {"label": "I'll install it myself", "description": "Open https://github.com/cayleygraph/cayley/releases — pause installation until cayley is on PATH"},
    {"label": "Skip Cayley install — install skill files only", "description": "Pack will be installed but unable to run until Cayley is on PATH"}
  ]
}
```

### Question 3: Existing GRAPH/ Directory

**Only ask if existing GRAPH/ found:**

```json
{
  "header": "Existing GRAPH/",
  "question": "An existing graph database was found at ~/.claude/PAI/MEMORY/GRAPH/. What should I do?",
  "multiSelect": false,
  "options": [
    {"label": "Preserve (Recommended)", "description": "Keep existing graph as-is, do not re-seed schemas (idempotent — duplicates are skipped)"},
    {"label": "Backup and Reset", "description": "Timestamped backup of GRAPH/, then start fresh with empty BoltDB"},
    {"label": "Reset Without Backup", "description": "Delete GRAPH/ entirely, start fresh"}
  ]
}
```

### Question 4: Migration

**Only ask if KNOWLEDGE/ exists with .md files:**

```json
{
  "header": "Migrate KNOWLEDGE/",
  "question": "Found N markdown files in MEMORY/KNOWLEDGE/. Migrate them into the graph after install?",
  "multiSelect": false,
  "options": [
    {"label": "Yes, migrate now (Recommended)", "description": "Parses frontmatter (entity_type, tags, links) and asserts each file as a graph node with edges. Idempotent — re-runnable."},
    {"label": "No, skip migration", "description": "Install only. You can run migration later via: bun src/Tools/MigrateKnowledge.ts"}
  ]
}
```

### Question 5: Final Confirmation

```json
{
  "header": "Install Mnemosyne",
  "question": "Ready to install Mnemosyne v1.0.0?",
  "multiSelect": false,
  "options": [
    {"label": "Yes, install now (Recommended)", "description": "Copies skill files, installs Cayley if requested, registers MCP server in settings.json, seeds schemas, optionally migrates KNOWLEDGE/"},
    {"label": "Show me what will change", "description": "Lists all files, directories, and settings.json changes"},
    {"label": "Cancel", "description": "Abort installation"}
  ]
}
```

**If user chose "Show me what will change":**

```
"Directories created:
- ~/.claude/skills/Mnemosyne/  (skill source)
- ~/.claude/PAI/MEMORY/GRAPH/  (Cayley BoltDB store, single file: mnemosyne.bolt)

Files created/updated:
- ~/.claude/skills/Mnemosyne/SKILL.md
- ~/.claude/skills/Mnemosyne/Workflows/{QueryGraph,AssertKnowledge,RecentActivity,MigrateFromFiles}.md
- ~/.claude/skills/Mnemosyne/References/{Architecture,SchemaGuide,CloudDeployment}.md
- ~/.claude/skills/Mnemosyne/Schemas/{epistemology,classifiers,scopes}.nq
- ~/.claude/skills/Mnemosyne/Config/cayley.yml
- ~/.claude/skills/Mnemosyne/Tools/{CayleyClient,InsideOut,McpServer,SeedSchemas,StartLocal,MigrateKnowledge}.ts
- ~/.claude/PAI/MEMORY/GRAPH/mnemosyne.bolt  (after first Cayley boot)
- ~/.claude/settings.json — adds 'mcpServers.mnemosyne' entry

What is NOT touched:
- ~/.claude/PAI/MEMORY/KNOWLEDGE/  (read-only during migration — never written)
- ~/.claude/PAI/MEMORY/WORK/, LEARNING/, RESEARCH/, STATE/ (untouched)
- Existing settings.json keys other than 'mcpServers.mnemosyne'"
```

Then re-ask the final confirmation.

---

## Phase 3: Backup (If Needed)

**Only execute if user chose "Backup and Replace" or "Backup and Reset":**

```bash
CLAUDE_DIR="$HOME/.claude"
BACKUP_DIR="$CLAUDE_DIR/Backups/mnemosyne-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ -d "$CLAUDE_DIR/skills/Mnemosyne" ]; then
  cp -r "$CLAUDE_DIR/skills/Mnemosyne" "$BACKUP_DIR/skill"
  echo "Backed up skill to: $BACKUP_DIR/skill"
fi

if [ -d "$CLAUDE_DIR/PAI/MEMORY/GRAPH" ]; then
  cp -r "$CLAUDE_DIR/PAI/MEMORY/GRAPH" "$BACKUP_DIR/graph"
  echo "Backed up graph to: $BACKUP_DIR/graph"
fi

# settings.json backup (always, since we'll modify it)
if [ -f "$CLAUDE_DIR/settings.json" ]; then
  cp "$CLAUDE_DIR/settings.json" "$BACKUP_DIR/settings.json"
  echo "Backed up settings.json to: $BACKUP_DIR/settings.json"
fi

echo "Backups complete at: $BACKUP_DIR"
```

---

## Phase 4: Installation

**Create a TodoWrite list to track progress:**

```json
{
  "todos": [
    {"content": "Install Cayley binary (if requested)", "status": "pending", "activeForm": "Installing Cayley"},
    {"content": "Create skill directory structure", "status": "pending", "activeForm": "Creating skill directories"},
    {"content": "Copy skill files", "status": "pending", "activeForm": "Copying skill files"},
    {"content": "Create graph directory", "status": "pending", "activeForm": "Creating graph directory"},
    {"content": "Register MCP server in settings.json", "status": "pending", "activeForm": "Registering MCP server"},
    {"content": "Start Cayley + seed schemas", "status": "pending", "activeForm": "Seeding schemas"},
    {"content": "Migrate KNOWLEDGE/ (if requested)", "status": "pending", "activeForm": "Migrating knowledge"},
    {"content": "Run verification", "status": "pending", "activeForm": "Running verification"}
  ]
}
```

### 4.1 Install Cayley (if user chose Homebrew)

```bash
brew install cayley
cayley version
```

Mark todo completed.

### 4.2 Create Skill Directory Structure

```bash
CLAUDE_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_DIR/skills/Mnemosyne"
mkdir -p "$CLAUDE_DIR/skills/Mnemosyne/Workflows"
mkdir -p "$CLAUDE_DIR/skills/Mnemosyne/References"
mkdir -p "$CLAUDE_DIR/skills/Mnemosyne/Schemas"
mkdir -p "$CLAUDE_DIR/skills/Mnemosyne/Config"
mkdir -p "$CLAUDE_DIR/skills/Mnemosyne/Tools"
echo "Created skill directories"
```

### 4.3 Copy Skill Files

```bash
PACK_DIR="$(pwd)"
CLAUDE_DIR="$HOME/.claude"
cp -r "$PACK_DIR/src/"* "$CLAUDE_DIR/skills/Mnemosyne/"
echo "Copied skill source"

# Sanity check
[ -f "$CLAUDE_DIR/skills/Mnemosyne/SKILL.md" ] && echo "OK SKILL.md installed" || echo "ERROR SKILL.md missing"
[ -f "$CLAUDE_DIR/skills/Mnemosyne/Tools/McpServer.ts" ] && echo "OK McpServer.ts installed" || echo "ERROR McpServer.ts missing"
[ -f "$CLAUDE_DIR/skills/Mnemosyne/package.json" ] && echo "OK package.json installed" || echo "ERROR package.json missing"
```

### 4.3.1 Install MCP SDK dependency

```bash
cd "$CLAUDE_DIR/skills/Mnemosyne" && bun install
```

This installs `@modelcontextprotocol/sdk` into `node_modules/` next to the pack's `package.json`. Bun resolves it for `McpServer.ts` automatically.

### 4.4 Create Graph Directory

```bash
CLAUDE_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_DIR/PAI/MEMORY/GRAPH"

# Render cayley.yml with absolute BoltDB path
GRAPH_DIR="$CLAUDE_DIR/PAI/MEMORY/GRAPH"
sed "s|__GRAPH_DIR__|$GRAPH_DIR|g" "$CLAUDE_DIR/skills/Mnemosyne/Config/cayley.yml" > "$GRAPH_DIR/cayley.yml"
echo "Cayley config rendered at: $GRAPH_DIR/cayley.yml"
```

### 4.5 Register MCP Server

Read existing `~/.claude/settings.json` (or `{}` if missing). Merge in:

```json
{
  "mcpServers": {
    "mnemosyne": {
      "command": "bun",
      "args": ["~/.claude/skills/Mnemosyne/Tools/McpServer.ts"],
      "env": {
        "CAYLEY_BASE_URL": "http://localhost:64210"
      }
    }
  }
}
```

Use the `Read` + `Edit` tools to merge — do not blow away unrelated keys. Preserve existing `mcpServers` entries; insert `mnemosyne` alongside them.

### 4.6 Start Cayley + Seed Schemas

```bash
CLAUDE_DIR="$HOME/.claude"
GRAPH_DIR="$CLAUDE_DIR/PAI/MEMORY/GRAPH"

# Start Cayley in background (with --init on first run, omit if BoltDB exists)
if [ -f "$GRAPH_DIR/mnemosyne.bolt" ]; then
  cayley http --config "$GRAPH_DIR/cayley.yml" --host 127.0.0.1:64210 \
    > "$GRAPH_DIR/cayley.log" 2>&1 &
else
  cayley http --config "$GRAPH_DIR/cayley.yml" --host 127.0.0.1:64210 --init \
    > "$GRAPH_DIR/cayley.log" 2>&1 &
fi

# Wait for ready, then seed
bun "$CLAUDE_DIR/skills/Mnemosyne/Tools/SeedSchemas.ts"
```

The `SeedSchemas.ts` tool waits for Cayley on the configured URL, then writes the three substrate schemas. Idempotent — re-runs skip duplicates because `load.ignore_duplicates: true` is set in `cayley.yml`.

### 4.7 Migrate KNOWLEDGE/ (If Requested)

```bash
CLAUDE_DIR="$HOME/.claude"
bun "$CLAUDE_DIR/skills/Mnemosyne/Tools/MigrateKnowledge.ts" \
  --knowledge-dir "$CLAUDE_DIR/PAI/MEMORY/KNOWLEDGE" \
  --scope pai:knowledge
```

Output reports nodes asserted, edges asserted, skipped files (missing/invalid frontmatter).

---

## Phase 5: Verification

**Execute all checks from VERIFY.md:**

```bash
CLAUDE_DIR="$HOME/.claude"

echo "=== Mnemosyne Verification ==="

# File checks
[ -f "$CLAUDE_DIR/skills/Mnemosyne/SKILL.md" ] && echo "OK SKILL.md" || echo "MISSING SKILL.md"
[ -f "$CLAUDE_DIR/skills/Mnemosyne/Tools/McpServer.ts" ] && echo "OK McpServer.ts" || echo "MISSING McpServer.ts"
[ -f "$CLAUDE_DIR/skills/Mnemosyne/Schemas/epistemology.nq" ] && echo "OK epistemology.nq" || echo "MISSING epistemology.nq"
[ -f "$CLAUDE_DIR/skills/Mnemosyne/Schemas/classifiers.nq" ] && echo "OK classifiers.nq" || echo "MISSING classifiers.nq"

# Cayley reachability
if curl -sf -X POST -d 'g.Vertex().GetLimit(1)' \
     http://127.0.0.1:64210/api/v1/query/gizmo >/dev/null 2>&1; then
  echo "OK Cayley reachable on 127.0.0.1:64210"
else
  echo "ERROR Cayley not reachable — check $CLAUDE_DIR/PAI/MEMORY/GRAPH/cayley.log"
fi

# Anchor nodes
ANCHORS=(
  "/epistemology/verified"
  "/epistemology/putative"
  "/epistemology/edge/has_state"
  "/classifier/entity"
  "/classifier/assertion/observation"
)
for node in "${ANCHORS[@]}"; do
  if curl -sf -X POST \
       -d "g.V(\"$node\").Out().GetLimit(1)" \
       http://127.0.0.1:64210/api/v1/query/gizmo | grep -q '"id"'; then
    echo "OK Anchor node present: $node"
  else
    echo "MISSING Anchor node: $node"
  fi
done

# settings.json MCP entry
if grep -q '"mnemosyne"' "$CLAUDE_DIR/settings.json" 2>/dev/null; then
  echo "OK mnemosyne MCP server registered in settings.json"
else
  echo "MISSING mnemosyne MCP server entry in settings.json"
fi

echo ""
echo "=== Verification Complete ==="
```

Mark verification todo completed when all checks pass.

---

## Success / Failure Messages

### On Success

```
"Mnemosyne v1.0.0 installed.

Restart Claude Code to load the MCP server.
After restart, try:

  recent_activity(since='1970-01-01T00:00:00Z', limit=10)
  list_by_state(epistemic_state='verified', limit=10)
  query(start_node='/classifier/entity', depth=1)

The graph is at ~/.claude/PAI/MEMORY/GRAPH/mnemosyne.bolt.
Cayley logs at ~/.claude/PAI/MEMORY/GRAPH/cayley.log.

To stop the local Cayley:  pkill -f 'cayley http'
To start again:  bun ~/.claude/skills/Mnemosyne/Tools/StartLocal.ts
To re-migrate KNOWLEDGE/:  bun ~/.claude/skills/Mnemosyne/Tools/MigrateKnowledge.ts"
```

### On Failure

```
"Installation encountered issues. Check:

1. bun is on PATH:  command -v bun
2. cayley is on PATH:  command -v cayley
3. Port 64210 is free:  lsof -iTCP:64210 -sTCP:LISTEN
4. Cayley log:  cat ~/.claude/PAI/MEMORY/GRAPH/cayley.log
5. settings.json is valid JSON:  bun -e 'JSON.parse(require(\"fs\").readFileSync(process.env.HOME + \"/.claude/settings.json\"))'

Re-run VERIFY.md commands to identify the failure point."
```

---

## Troubleshooting

### MCP server doesn't load after restart

Verify `~/.claude/settings.json` has a `mcpServers.mnemosyne` entry with a runnable `command`. Check that `bun` is on PATH for non-interactive shells (Claude Code launches MCP servers as subprocesses — ensure `~/.bashrc` or `~/.zshrc` exports the path Bun was installed to).

### Cayley fails to start

Check `~/.claude/PAI/MEMORY/GRAPH/cayley.log`. Common causes: port already in use (change `--host` flag), BoltDB lock from a previous run (remove `*.lock` files alongside `mnemosyne.bolt`), permission denied on graph dir.

### Seeding fails with "CRLF detected"

The schema files must be LF-only. If your `.gitattributes` is set to CRLF on `.nq` files (unlikely on macOS/Linux), Cayley silently fails on `\r`. Run `dos2unix ~/.claude/skills/Mnemosyne/Schemas/*.nq`.

### Migration imports 0 nodes

Migration parses YAML frontmatter from `MEMORY/KNOWLEDGE/**/*.md`. Files without frontmatter, or with `entity_type` missing, are skipped. Check `~/.claude/PAI/MEMORY/KNOWLEDGE/_schema.md` to see the expected frontmatter shape. Re-run with `--verbose` for skip reasons.

### "Already exists" errors during seed

Cayley's `load.ignore_duplicates: true` should swallow these. If you see them anyway, you may have seeded an older schema version — back up the graph and re-seed: `mv ~/.claude/PAI/MEMORY/GRAPH ~/.claude/PAI/MEMORY/GRAPH.old && bun ~/.claude/skills/Mnemosyne/Tools/StartLocal.ts && bun ~/.claude/skills/Mnemosyne/Tools/SeedSchemas.ts`.

---

## What's Included

| Path | Purpose |
|------|---------|
| `src/SKILL.md` | Skill activator |
| `src/Workflows/QueryGraph.md` | Inside-out query workflow |
| `src/Workflows/AssertKnowledge.md` | Writing nodes + edges with epistemic envelope |
| `src/Workflows/RecentActivity.md` | Catch-up workflow |
| `src/Workflows/MigrateFromFiles.md` | Import MEMORY/KNOWLEDGE/ into graph |
| `src/References/Architecture.md` | How the pack sits next to file-based MEMORY |
| `src/References/SchemaGuide.md` | Predicate + scope + classifier vocab |
| `src/References/CloudDeployment.md` | Optional GCP topology (doc-only) |
| `src/Schemas/epistemology.nq` | Substrate: epistemic states + edges |
| `src/Schemas/classifiers.nq` | Substrate: self-similar taxonomy |
| `src/Schemas/scopes.nq` | PAI-native context scopes |
| `src/Config/cayley.yml` | BoltDB local config (path placeholder rendered at install) |
| `src/Tools/CayleyClient.ts` | HTTP wrapper |
| `src/Tools/InsideOut.ts` | Query engine |
| `src/Tools/McpServer.ts` | MCP server (stdio, 13 tools) |
| `src/Tools/SeedSchemas.ts` | Parse + load .nq files |
| `src/Tools/StartLocal.ts` | Boot Cayley locally |
| `src/Tools/MigrateKnowledge.ts` | KNOWLEDGE/ → graph importer |

All files in `src/` are copied to `~/.claude/skills/Mnemosyne/` during installation.
