# Schema Guide

The substrate is three NQuad files in `Schemas/`. They define the vocabulary every assertion and query speaks. Read this when you want to understand or extend the type system.

## Files

| File | Purpose | Quad count |
|---|---|---|
| `epistemology.nq` | Epistemic states, justification, scopes (substrate), edges, EdgeInstance (CVT), evidence, debunking, predictive records, inference patterns | ~150 |
| `classifiers.nq` | Self-similar Entity / Process / Assertion / Relationship taxonomy | ~130 |
| `scopes.nq` | PAI-native ContextScopes (`pai:memory`, `pai:knowledge`, `pai:work`, `pai:learning`, `pai:project`, `pai:system`) | ~30 |

Load order matters: epistemology → classifiers → scopes. Scopes reference the `ContextScope` type defined in epistemology.

## Epistemic states (with rank)

| State | Rank | Meaning |
|---|---|---|
| `verified` | 1 | Independently replicated; prediction record positive |
| `putative` | 2 | Plausible, evidence present, not stress-tested |
| `emergent` | 2 | Arose from intersection of prior nodes; neither agent anticipated it alone |
| `speculative` | 3 | Structurally coherent, minimal direct evidence |
| `contested` | 4 | Active conflict between supporting and contradicting evidence |
| `debunked` | 5 | Falsification succeeded. Preserved for provenance, never deleted |
| `fictional` | 5 | True within a scoped narrative context, false outside it |

Rank is used by `query`'s `epistemic_floor` — entries with `rank > floor_rank` are pruned.

## Justification types

| Justification | Meaning |
|---|---|
| `empirical` | Direct measurement or observation |
| `inferential` | Derived from other verified/putative nodes |
| `testimonial` | Reported by a trusted agent (or by a markdown source on migration) |
| `intuitive` | Pattern recognition without explicit chain — flag for verification, not dismissal |
| `emergent` (`/epistemology/emergent_justification`) | Product of inside-out closure; structurally justified |

## Substrate scopes (in epistemology.nq)

- `physical_reality` — claims that hold in the world independent of system layer.

PAI-system scopes live in `scopes.nq`:

- `pai:memory` — runtime memory; default for ad-hoc graph asserts
- `pai:knowledge` — migrated KNOWLEDGE/ entries
- `pai:work` — ISA / work session tracking
- `pai:learning` — failures, signals, synthesis
- `pai:project` — per-project umbrella (suffix with project name)
- `pai:system` — PAI infrastructure

**Adding your own scopes:** copy `scopes.nq` to your install (`~/.claude/skills/Mnemosyne/Schemas/`), append the new ones, and re-seed. Cayley's `load.ignore_duplicates` handles re-runs.

## Classifier tree (in classifiers.nq)

Four orthogonal axes, each with sub-types. Every classifier node is itself a `/type/type`, so the inside-out query algorithm doesn't have a special case for "leaf vs interior" — it walks the same way at every level.

### Entity — things that exist

- `/classifier/entity/agent` (root for agents)
  - `/classifier/entity/agent/conscious` — humans, principled AI, claimants
  - `/classifier/entity/agent/collective` — teams, organizations, ensembles
  - `/classifier/entity/agent/artificial` — software agents, DA, MCP servers
- `/classifier/entity/artifact` — documents, models, recordings, code
- `/classifier/entity/concept` — abstractions, patterns, frameworks
- `/classifier/entity/place` — locations, environments, deployment targets

### Process — things that happen

- `/classifier/process/physical` — execution, transmission, propagation
- `/classifier/process/cognitive` — perception, reasoning, memory
- `/classifier/process/communicative` — protocols, broadcasts, MCP messages
- `/classifier/process/emergent` — not anticipated from components

### Assertion — claims about the world

- `/classifier/assertion/observation` — directly measured (empirical)
- `/classifier/assertion/inference` — derived from other nodes (inferential)
- `/classifier/assertion/prediction` — testable future claim
- `/classifier/assertion/model` — explanatory framework
- `/classifier/assertion/decision` — chosen course of action

### Relationship — how things connect

- `/classifier/relationship/causal` — A causes B
- `/classifier/relationship/structural` — topology / composition
- `/classifier/relationship/temporal` — before / after / cyclical
- `/classifier/relationship/epistemic` — supports / contradicts / derives_from
- `/classifier/relationship/analogical` — cross-domain ontology mapping

## Edge predicates (from epistemology.nq)

| Predicate | Direction | Use |
|---|---|---|
| `/epistemology/edge/has_state` | forward | node → epistemic_state (always; direct annotation) |
| `/epistemology/edge/scoped_to` | forward | node → ContextScope (always) |
| `/epistemology/edge/justification_type` | forward | node → JustificationType |
| `/epistemology/edge/provenance` | forward | node → literal source reference |
| `/epistemology/edge/written_at` | forward | node → ISO-8601 literal (stamped on every write) |
| `/epistemology/edge/supports` | forward | evidence → assertion |
| `/epistemology/edge/contradicts` | forward | evidence → assertion |
| `/epistemology/edge/derives_from` | forward | child → parent (provenance / lineage) |
| `/epistemology/edge/emerged_from` | forward | emergent → parents (two or more) |
| `/epistemology/edge/predicts` | forward | model → testable_prediction |
| `/epistemology/edge/debunking_attempted_by` | forward | assertion → DebunkingAttempt |

## EdgeInstance (CVT pattern)

Every `assert_edge` writes both:

1. **Direct quad(s)** — for fast `inside_out_query` traversal.
2. **An EdgeInstance node** at `/edge/instance/<sha1-prefix>` — carries weight, direction, epistemic_state, scope, provenance.

The SHA1 is computed from `subject|predicate|object`. So:

- Re-asserting the same edge with different weight = updates the EdgeInstance in place.
- Multiple writes are idempotent — no duplicate edges.
- The relationship itself can be verified, contested, debunked — query the EdgeInstance's `has_state` edge.

## Inference patterns

`/epistemology/inference_pattern` is a small ontology of HOW emergent nodes arise:

- `closure` — cyclic self-reference (unreachable reductively, discoverable by scaling up)
- `spanning-tree-consensus` — distributed convergence via fan-in
- `phase-coherence` — temporal synchronization across independent agents
- `fractal-recurrence` — pattern recognized at multiple scales simultaneously
- `ontology-rotation` — structural preservation across coordinate systems / vocabularies

When you assert an `emergent` node, optionally link it back to the inference pattern that produced it via `derives_from` — preserves the reasoning trail.

## Extending the schema

The substrate is deliberately small. Add your own:

```bash
# 1. Write a new .nq file. LF-only, no \r.
cat > ~/.claude/skills/Mnemosyne/Schemas/myextension.nq <<'EOF'
# My custom types
</mydomain/type/foo> </type/object/type> </type/type> .
</mydomain/type/foo> </type/object/name> "MyFoo" .
</mydomain/type/foo> </common/topic/description> "A foo in my domain." .
EOF

# 2. Re-seed. Idempotent — duplicates dropped.
bun ~/.claude/skills/Mnemosyne/Tools/SeedSchemas.ts

# 3. (Optional) Edit SeedSchemas.ts to include myextension.nq in SEED_ORDER
#    so subsequent installs pick it up too.
```

Keep your extension in its own file. Don't edit the substrate schemas — that breaks portability across PAI installs.
