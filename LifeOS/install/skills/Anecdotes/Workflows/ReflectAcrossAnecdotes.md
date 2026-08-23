# Workflow: Reflect Across Anecdotes

Once you have a corpus in the graph, the next move is pattern mining — what do these anecdotes have in common, where do they contradict, what heuristics emerge across contributors? This workflow is for that.

## When to use

- The user asks "what patterns emerge from these stories?"
- You want to surface contradictions: anecdote A's insight contradicts anecdote B's.
- You're preparing a synthesis or a report grounded in the corpus.
- You want to find under-covered or over-covered topics.

## Reflection patterns

### 1. Cluster by tag overlap

Anecdotes that share many tags are likely to share an underlying topic. Find tag clusters:

```bash
# All tags in the corpus, sorted by anecdote count
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --scope anecdotes:prototype \
  | jq -r '[.[] | .tags[]] | group_by(.) | map({tag: .[0], count: length}) | sort_by(-.count) | .[]' \
  | head -20
```

### 2. Compare insights across modalities

Reflective anecdotes (Franklin, etc.) tend to have explicit insights; curated anecdotes (Feynman) tend to be implicit. Verify this in your corpus:

```bash
for m in reflective curated dictated dialectic interview; do
  COUNT_EXPLICIT=$(curl -sf -X POST -d \
    "g.V(\"/anecdote/modality/$m\").In(\"/anecdote/edge/has_modality\").Has(\"/anecdote/anecdote/insight_explicit\",\"\\\"true\\\"\").Count()" \
    http://localhost:64211/api/v1/query/gizmo)
  COUNT_IMPLICIT=$(curl -sf -X POST -d \
    "g.V(\"/anecdote/modality/$m\").In(\"/anecdote/edge/has_modality\").Has(\"/anecdote/anecdote/insight_explicit\",\"\\\"false\\\"\").Count()" \
    http://localhost:64211/api/v1/query/gizmo)
  echo "$m: explicit=$COUNT_EXPLICIT implicit=$COUNT_IMPLICIT"
done
```

### 3. Find anecdotes with contradicting insights

This requires semantic comparison — not graph-native. Pull all insights to LLM and ask for contradiction pairs:

```bash
bun ~/.claude/skills/Anecdotes/Tools/AnecdotesCli.ts query --scope anecdotes:prototype \
  | jq -r '.[] | "- [\(.title)] \(.insight)"' \
  > /tmp/all-insights.md

# Hand /tmp/all-insights.md to an LLM with prompt:
# "Find pairs of items that contradict or qualify each other. Output as JSON
#  array of {id_a, id_b, relation: 'contradicts'|'qualifies', reasoning}."
```

For each detected contradiction, optionally assert a contradiction edge in the graph via Mnemosyne:

```
mcp__mnemosyne__assert_edge(
  subject_id="/anecdote/anecdote/.../A",
  predicate="/epistemology/edge/contradicts",
  object_id="/anecdote/anecdote/.../B",
  direction="bidirectional",
  weight=0.7,
  epistemic_state="putative",
  scope="anecdotes:prototype",
  provenance="LLM contradiction pass 2026-05-26"
)
```

The contradiction is itself a graph-first-class fact — re-querying will show both anecdotes are in `contested` state if the edge is followed.

### 4. Coverage map

What domains are over-covered and under-covered?

```bash
for d in talent_agent tour_management lighting_design sound_engineering \
         journalism civic_life physics mathematics software_engineering other; do
  COUNT=$(curl -sf -X POST -d \
    "g.V(\"/anecdote/domain/$d\").In(\"/anecdote/edge/expertise_domain\").Count()" \
    http://localhost:64211/api/v1/query/gizmo)
  printf "%-25s %s\n" "$d" "$COUNT"
done
```

### 5. Contributor coverage

How many anecdotes per contributor? Which domains does each cover?

```bash
# All historical contributors with their anecdote counts
curl -sf -X POST -d \
  'g.V("/anecdote/contributor_status/historical").In("/anecdote/contributor/status").Tag("c").In("/anecdote/edge/contributed_by").Count()' \
  http://localhost:64211/api/v1/query/gizmo
```

For per-contributor breakdown, loop:

```bash
for c in $(curl -sf -X POST -d \
  'g.V("/anecdote/contributor").In("/type/object/type").GetLimit(100)' \
  http://localhost:64211/api/v1/query/gizmo | jq -r '.result[].id'); do
  ANEC=$(curl -sf -X POST -d \
    "g.V(\"$c\").In(\"/anecdote/edge/contributed_by\").Count()" \
    http://localhost:64211/api/v1/query/gizmo)
  printf "%-50s %s\n" "$c" "$ANEC"
done
```

## Synthesis pattern: assert an emergent insight

When reflection surfaces a heuristic that none of the individual anecdotes state, assert it as an `emergent` node in Mnemosyne and link it to the source anecdotes:

```
mcp__mnemosyne__assert_node(
  node_id="/pai/insight/emergent/temperance-beats-rules",
  name="Temperance beats explicit rules across cultures",
  description="Multiple historical reflective anecdotes from different domains converge on the same heuristic: explicit rule-following without underlying disposition fails.",
  node_type="/classifier/assertion/inference",
  epistemic_state="emergent",
  scope="anecdotes:prototype",
  justification="emergent",
  provenance="cross-corpus reflection 2026-05-26"
)

# Then link the source anecdotes
mcp__mnemosyne__assert_edge(
  subject_id="/pai/insight/emergent/temperance-beats-rules",
  predicate="/epistemology/edge/emerged_from",
  object_id="/anecdote/anecdote/franklin/the-water-american_abc123",
  direction="forward",
  weight=0.8,
  epistemic_state="putative",
  scope="anecdotes:prototype"
)
# (repeat for each source anecdote)
```

The `emergent` epistemic state is reserved for exactly this — claims that no single source supports alone but the cluster supports collectively. Linking via `emerged_from` preserves the reasoning trail.

## Output: a synthesis report

Once you have findings, write them up as a markdown file in `~/.claude/PAI/MEMORY/RESEARCH/anecdotes-synthesis-YYYY-MM-DD.md`. Include:

- Tag cluster summary
- Per-modality explicit/implicit insight rates
- Detected contradiction pairs (with reasoning)
- Coverage map
- New emergent insights asserted (with their node IDs)

This is what closes the loop — the synthesis itself becomes searchable PAI content, and the emergent graph nodes are queryable via Mnemosyne.

## Anti-patterns

- **Asserting an `emergent` node without `emerged_from` edges.** That's just a `putative` claim — emergent is structurally justified, which means it points back at its parents.
- **Marking contradictions as `verified` debunked.** Use `contested` first. `debunked` requires a formal falsification attempt, not just one contradicting peer.
- **Reflecting on tiny corpora.** Pattern mining over <20 anecdotes is anecdotal itself. Wait until you have a corpus.
- **Letting reflection synthesis live only as a markdown file.** The whole point of having a graph is that reflections become first-class nodes. Assert them.
