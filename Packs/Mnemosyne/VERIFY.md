# Mnemosyne v1.0.0 — Post-Install Verification

Run these checks after `INSTALL.md` completes. Every check should pass; if one fails, see `INSTALL.md § Troubleshooting`.

---

## 1. Skill files present

```bash
CLAUDE_DIR="$HOME/.claude"

for f in SKILL.md \
         Workflows/QueryGraph.md \
         Workflows/AssertKnowledge.md \
         Workflows/RecentActivity.md \
         Workflows/MigrateFromFiles.md \
         References/Architecture.md \
         References/SchemaGuide.md \
         References/CloudDeployment.md \
         Schemas/epistemology.nq \
         Schemas/classifiers.nq \
         Schemas/scopes.nq \
         Config/cayley.yml \
         Tools/CayleyClient.ts \
         Tools/InsideOut.ts \
         Tools/McpServer.ts \
         Tools/SeedSchemas.ts \
         Tools/StartLocal.ts \
         Tools/MigrateKnowledge.ts; do
  if [ -f "$CLAUDE_DIR/skills/Mnemosyne/$f" ]; then
    echo "OK $f"
  else
    echo "MISSING $f"
  fi
done
```

**Expected:** 17 `OK` lines, zero `MISSING`.

---

## 2. SKILL.md frontmatter valid

```bash
head -1 "$HOME/.claude/skills/Mnemosyne/SKILL.md" | grep -q "^---" \
  && echo "OK SKILL.md has frontmatter" \
  || echo "ERROR SKILL.md missing frontmatter"
```

---

## 3. Schemas are LF-only (no CRLF)

```bash
for nq in "$HOME/.claude/skills/Mnemosyne/Schemas/"*.nq; do
  if grep -l $'\r' "$nq" >/dev/null 2>&1; then
    echo "ERROR CRLF detected in $nq — Cayley will silently fail"
  else
    echo "OK LF-only: $(basename $nq)"
  fi
done
```

**Expected:** 3 `OK` lines.

---

## 4. Graph directory + config rendered

```bash
GRAPH_DIR="$HOME/.claude/PAI/MEMORY/GRAPH"
[ -d "$GRAPH_DIR" ] && echo "OK $GRAPH_DIR exists" || echo "MISSING $GRAPH_DIR"
[ -f "$GRAPH_DIR/cayley.yml" ] && echo "OK $GRAPH_DIR/cayley.yml exists" || echo "MISSING $GRAPH_DIR/cayley.yml"

# No unrendered placeholders
if grep -q '__GRAPH_DIR__' "$GRAPH_DIR/cayley.yml" 2>/dev/null; then
  echo "ERROR cayley.yml still contains __GRAPH_DIR__ placeholder"
else
  echo "OK cayley.yml has been rendered"
fi
```

---

## 5. Cayley reachable

```bash
if curl -sf -X POST -d 'g.Vertex().GetLimit(1)' \
     http://127.0.0.1:64210/api/v1/query/gizmo >/dev/null 2>&1; then
  echo "OK Cayley reachable on 127.0.0.1:64210"
else
  echo "ERROR Cayley not reachable"
  echo "  Check: cat $HOME/.claude/PAI/MEMORY/GRAPH/cayley.log"
  echo "  Start: bun $HOME/.claude/skills/Mnemosyne/Tools/StartLocal.ts"
fi
```

---

## 6. Schema anchor nodes seeded

```bash
ANCHORS=(
  "/epistemology/epistemic_state"
  "/epistemology/verified"
  "/epistemology/putative"
  "/epistemology/speculative"
  "/epistemology/contested"
  "/epistemology/debunked"
  "/epistemology/edge/has_state"
  "/epistemology/edge/scoped_to"
  "/epistemology/edge/written_at"
  "/classifier/kind"
  "/classifier/entity"
  "/classifier/process"
  "/classifier/assertion"
  "/classifier/relationship"
  "/classifier/assertion/observation"
  "/epistemology/scope/physical_reality"
  "/epistemology/scope/pai_memory"
  "/epistemology/scope/pai_knowledge"
)
for node in "${ANCHORS[@]}"; do
  if curl -sf -X POST \
       -d "g.V(\"$node\").Out().GetLimit(1)" \
       http://127.0.0.1:64210/api/v1/query/gizmo | grep -q '"id"'; then
    echo "OK $node"
  else
    echo "MISSING $node"
  fi
done
```

**Expected:** 18 `OK` lines. Any `MISSING` line indicates a schema seeding failure — re-run `bun ~/.claude/skills/Mnemosyne/Tools/SeedSchemas.ts`.

---

## 7. Round-trip assert + query

```bash
# Assert a test node
curl -sf -X POST -H "Content-Type: application/json" \
  -d '[
    {"subject":"/pai/verify/test_node","predicate":"/type/object/type","object":"/classifier/assertion/observation"},
    {"subject":"/pai/verify/test_node","predicate":"/type/object/name","object":"\"verify-test\""},
    {"subject":"/pai/verify/test_node","predicate":"/epistemology/edge/has_state","object":"/epistemology/putative"},
    {"subject":"/pai/verify/test_node","predicate":"/epistemology/edge/scoped_to","object":"/epistemology/scope/pai_memory"}
  ]' \
  http://127.0.0.1:64210/api/v1/write >/dev/null && echo "OK write succeeded" || echo "ERROR write failed"

# Query back
RESULT=$(curl -sf -X POST \
  -d 'g.V("/pai/verify/test_node").Out("/type/object/name").GetLimit(1)' \
  http://127.0.0.1:64210/api/v1/query/gizmo)
echo "$RESULT" | grep -q "verify-test" \
  && echo "OK round-trip query returned node" \
  || echo "ERROR query did not return node — got: $RESULT"

# Cleanup
curl -sf -X POST -H "Content-Type: application/json" \
  -d '[
    {"subject":"/pai/verify/test_node","predicate":"/type/object/type","object":"/classifier/assertion/observation"},
    {"subject":"/pai/verify/test_node","predicate":"/type/object/name","object":"\"verify-test\""},
    {"subject":"/pai/verify/test_node","predicate":"/epistemology/edge/has_state","object":"/epistemology/putative"},
    {"subject":"/pai/verify/test_node","predicate":"/epistemology/edge/scoped_to","object":"/epistemology/scope/pai_memory"}
  ]' \
  http://127.0.0.1:64210/api/v1/delete >/dev/null && echo "OK test node deleted"
```

---

## 8. MCP server registered

```bash
if grep -q '"mnemosyne"' "$HOME/.claude/settings.json" 2>/dev/null; then
  echo "OK mnemosyne MCP entry in settings.json"
  bun -e 'try { const s = JSON.parse(require("fs").readFileSync(process.env.HOME + "/.claude/settings.json")); const m = s?.mcpServers?.mnemosyne; if (!m) throw new Error("no mnemosyne"); console.log("OK command:", m.command, "args:", JSON.stringify(m.args)); } catch (e) { console.error("ERROR settings.json invalid:", e.message); process.exit(1); }'
else
  echo "MISSING mnemosyne entry in settings.json"
fi
```

---

## 9. MCP server boots (smoke test)

```bash
# Start the MCP server briefly to confirm it loads without error
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"1.0"}}}' | \
  CAYLEY_BASE_URL="http://127.0.0.1:64210" \
  timeout 5 bun "$HOME/.claude/skills/Mnemosyne/Tools/McpServer.ts" 2>&1 | \
  grep -q '"protocolVersion"' \
  && echo "OK MCP server responds to initialize" \
  || echo "ERROR MCP server did not respond — check bun + module errors"
```

**Note:** If you don't have `timeout` on macOS, install via `brew install coreutils` and use `gtimeout`. This check is optional — the real test is restarting Claude Code and seeing `mcp__mnemosyne__*` tools available.

---

## 10. Migration (if KNOWLEDGE/ was migrated)

```bash
# How many migrated nodes are in scope pai:knowledge?
COUNT=$(curl -sf -X POST \
  -d 'g.V("/epistemology/scope/pai_knowledge").In("/epistemology/edge/scoped_to").Count()' \
  http://127.0.0.1:64210/api/v1/query/gizmo)
echo "Nodes in pai:knowledge scope: $COUNT"

# Recent activity should show migration writes
curl -sf -X POST \
  -d 'g.V().Out("/epistemology/edge/written_at").In("/epistemology/edge/written_at").Unique().Count()' \
  http://127.0.0.1:64210/api/v1/query/gizmo
```

If you skipped migration, this section is N/A.

---

## All Checks Passed?

You're done. Restart Claude Code to pick up the new MCP server. In your next session you should see `mcp__mnemosyne__query`, `mcp__mnemosyne__node`, `mcp__mnemosyne__assert_node`, etc. in the available tools.

Try:

```
"What was touched in the graph today?"
```

The DA should call `mcp__mnemosyne__recent_activity` with a 24h `since`.
