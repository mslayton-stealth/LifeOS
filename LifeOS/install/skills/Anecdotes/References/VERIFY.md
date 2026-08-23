# Anecdotes v1.0.0 — Post-Install Verification

Pre-req: Mnemosyne pack installed and Cayley running on `$CAYLEY_BASE_URL` (default `http://localhost:64211`).

---

## 1. Skill files present

```bash
CLAUDE_DIR="$HOME/.claude"

for f in SKILL.md \
         Workflows/CaptureAnecdote.md \
         Workflows/QueryAnecdotes.md \
         Workflows/ReflectAcrossAnecdotes.md \
         References/Schema.md \
         References/CorpusGuide.md \
         Schemas/anecdotes.nq \
         Tools/CayleyClient.ts \
         Tools/Prompts.ts \
         Tools/Extract.ts \
         Tools/Quads.ts \
         Tools/SeedSchema.ts \
         Tools/AnecdotesCli.ts; do
  if [ -f "$CLAUDE_DIR/skills/Anecdotes/$f" ]; then
    echo "OK $f"
  else
    echo "MISSING $f"
  fi
done
```

**Expected:** 13 `OK` lines.

---

## 2. Schema anchor nodes seeded

```bash
CAYLEY_URL="${CAYLEY_BASE_URL:-http://localhost:64211}"

ANCHORS=(
  "/anecdote/anecdote"
  "/anecdote/anecdote/setup"
  "/anecdote/anecdote/complication"
  "/anecdote/anecdote/resolution"
  "/anecdote/anecdote/insight"
  "/anecdote/modality"
  "/anecdote/modality/dictated"
  "/anecdote/modality/reflective"
  "/anecdote/modality/curated"
  "/anecdote/modality/dialectic"
  "/anecdote/modality/interview"
  "/anecdote/utterance"
  "/anecdote/contributor"
  "/anecdote/contributor_status/active"
  "/anecdote/contributor_status/historical"
  "/anecdote/domain_expertise"
  "/anecdote/domain/talent_agent"
  "/anecdote/domain/journalism"
  "/anecdote/edge/contributed_by"
  "/anecdote/edge/has_modality"
  "/anecdote/edge/has_utterance"
  "/epistemology/scope/anecdotes_prototype"
)
for node in "${ANCHORS[@]}"; do
  if curl -sf -X POST -d "g.V(\"$node\").Out().GetLimit(1)" \
       "$CAYLEY_URL/api/v1/query/gizmo" | grep -q '"id"'; then
    echo "OK $node"
  else
    echo "MISSING $node"
  fi
done
```

**Expected:** 22 `OK` lines. Any `MISSING` → re-seed: `bun ~/.claude/skills/Anecdotes/Tools/SeedSchema.ts`.

---

## 3. CLI prompt subcommand

```bash
CLAUDE_DIR="$HOME/.claude"
echo "Sample paragraph for testing." > /tmp/anecdotes-smoke.txt
bun "$CLAUDE_DIR/skills/Anecdotes/Tools/AnecdotesCli.ts" prompt /tmp/anecdotes-smoke.txt \
  | grep -q "anecdote extractor" \
  && echo "OK prompt subcommand emits extraction template" \
  || echo "ERROR prompt subcommand broken"
rm -f /tmp/anecdotes-smoke.txt
```

---

## 4. End-to-end ingest round-trip

```bash
CLAUDE_DIR="$HOME/.claude"
CAYLEY_URL="${CAYLEY_BASE_URL:-http://localhost:64211}"

# Synthetic LLM response — 1 reflective + 1 dialectic anecdote
cat > /tmp/anecdotes-resp.json <<'EOF'
[
  {
    "title": "verify install end to end",
    "modality": "reflective",
    "setup": "After installing the Anecdotes pack, the operator wanted to confirm the round trip worked end to end.",
    "complication": "Smoke tests can miss real-world issues that only show up when actually parsing and writing quads.",
    "resolution": "She ran the ingest CLI against a synthetic response and verified the node appeared in the Cayley graph.",
    "insight": "Synthesize a small but representative end-to-end test before declaring an install verified.",
    "insight_explicit": true,
    "characters": ["the operator"],
    "tags": ["verification", "round_trip", "smoke_test"],
    "domains": ["software_engineering"],
    "source_excerpt": "the operator ran the ingest CLI against a synthetic response and verified the node appeared in the Cayley graph."
  }
]
EOF

bun "$CLAUDE_DIR/skills/Anecdotes/Tools/AnecdotesCli.ts" ingest /tmp/anecdotes-resp.json \
  --contributor /anecdote/contributor/verify-fixture \
  --create-contributor --contributor-name 'verify-fixture' --contributor-status historical \
  --out /tmp/anecdotes-quads.json >/dev/null 2>&1 \
  && echo "OK ingest produced quads" || echo "ERROR ingest failed"

bun "$CLAUDE_DIR/skills/Anecdotes/Tools/AnecdotesCli.ts" write /tmp/anecdotes-quads.json \
  >/dev/null 2>&1 \
  && echo "OK write succeeded" || echo "ERROR write failed"

# Query back
COUNT=$(curl -sf -X POST \
  -d 'g.V("/epistemology/scope/anecdotes_prototype").In("/epistemology/edge/scoped_to").Has("/type/object/type","/anecdote/anecdote").Count()' \
  "$CAYLEY_URL/api/v1/query/gizmo")
echo "Anecdotes in scope anecdotes:prototype: $COUNT"

# Verify our specific test node is queryable
TITLE=$(curl -sf -X POST \
  -d 'g.V("/anecdote/contributor/verify-fixture").In("/anecdote/edge/contributed_by").Out("/type/object/name").GetLimit(1)' \
  "$CAYLEY_URL/api/v1/query/gizmo")
echo "$TITLE" | grep -q "verify install end to end" \
  && echo "OK round-trip query found the test anecdote" \
  || echo "ERROR did not find test anecdote (got: $TITLE)"

rm -f /tmp/anecdotes-resp.json /tmp/anecdotes-quads.json
```

---

## 5. Query subcommand

```bash
CLAUDE_DIR="$HOME/.claude"
bun "$CLAUDE_DIR/skills/Anecdotes/Tools/AnecdotesCli.ts" query --by-domain software_engineering \
  | grep -q "verify install end to end" \
  && echo "OK query --by-domain found the test anecdote" \
  || echo "INFO query --by-domain returned different results (re-check after test cleanup)"

bun "$CLAUDE_DIR/skills/Anecdotes/Tools/AnecdotesCli.ts" query --by-tag verification \
  | grep -q "verify install end to end" \
  && echo "OK query --by-tag found the test anecdote" \
  || echo "INFO query --by-tag returned different results"
```

---

## 6. Reachable via Mnemosyne MCP

After restarting Claude Code (so MCP server reloads), the anecdotes are queryable through the standard Mnemosyne tools:

```
mcp__mnemosyne__list_by_scope(scope="anecdotes:prototype", limit=10)
mcp__mnemosyne__query(start_node="/anecdote/contributor/verify-fixture", depth=1)
mcp__mnemosyne__node(node_id="/anecdote/anecdote/verify-fixture/<slug>_<hash>")
```

No new MCP server is added by this pack — reads go through Mnemosyne's existing `mnemosyne` MCP.

---

## All checks passed?

You're ready. Try the full pipeline against a real corpus chunk — see `Workflows/CaptureAnecdote.md` for the end-to-end recipe.
