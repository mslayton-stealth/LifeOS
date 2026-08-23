# Workflow: Assert Knowledge

When the user makes a claim worth tracking — an observation, prediction, decision, belief, or relationship — record it as graph state. Mnemosyne is designed so every assertion carries its epistemic envelope (state + justification + scope + provenance) and every edge can itself be verified or debunked.

## When to assert

| User says | Tool | What you record |
|---|---|---|
| "We confirmed X" | `assert_node` (state=verified) | Observation with empirical justification |
| "I think X" | `assert_node` (state=putative or speculative) | Inference or model, intuitive justification |
| "X causes Y" | `assert_edge` (predicate=/classifier/relationship/causal) | Reified edge with weight |
| "X contradicts Y" | `assert_edge` (predicate=/epistemology/edge/contradicts) | Negative-evidence edge |
| "X supports Y" | `assert_edge` (predicate=/epistemology/edge/supports) | Positive-evidence edge |
| "X derives from Y" | `assert_edge` (predicate=/epistemology/edge/derives_from) | Provenance / lineage |
| "We decided to X" | `assert_node` (type=/classifier/assertion/decision) | Decision node with rationale |

## Picking `epistemic_state`

| State | Use when |
|---|---|
| `verified` | Independently replicated; you have direct evidence; prediction record positive. |
| `putative` | Plausible, evidence present, not stress-tested. **Most ad-hoc claims start here.** |
| `emergent` | Arose from an inside-out closure — none of the parents alone implied it. Tag with `inferential` justification. |
| `speculative` | Structurally coherent, minimal direct evidence. A hypothesis worth tracking. |
| `contested` | Active disagreement. Use sparingly; usually you assert verified or debunked and let the contradiction edges fight it out. |
| `debunked` | Falsification attempt succeeded. **Never delete** — preserve for provenance. Subsequent queries with default floor will exclude it. |
| `fictional` | True within a narrative scope, false outside. Use for stories, RPGs, hypotheticals, what-if exploration. |

**Default for a fresh claim:** `putative` with `inferential` or `testimonial` justification. Promote to `verified` only after independent confirmation.

## Picking `justification`

| Justification | Use when |
|---|---|
| `empirical` | You measured it. Benchmark, observation, log line. |
| `inferential` | You derived it from other nodes in the graph. |
| `testimonial` | Someone said so — the user, a document, a paper. Always pair with `provenance` if possible. |
| `intuitive` | Pattern recognition, no explicit chain. Flag for follow-up verification, but don't dismiss. |
| `emergent` | Output of an inside-out closure. Structurally justified — no human chose it. |

## Picking `scope`

| Scope | Use when |
|---|---|
| `physical_reality` | Claim holds independent of any system layer. "Water boils at 100°C at sea level." |
| `pai:memory` | Default for ad-hoc inline asserts during a session. |
| `pai:knowledge` | Migrated or curated knowledge — should be backed by a markdown file in `MEMORY/KNOWLEDGE/`. |
| `pai:work` | Tied to a specific work session — ISA mirrors, coordination tasks. |
| `pai:learning` | Extracts from LEARNING/ — ratings, failures, synthesis. |
| `pai:project` | Per-project. Append project name as a sub-scope: `pai:project:foo`. |
| `pai:system` | PAI infrastructure — hooks, settings, install/upgrade. |

## Assert a new node — template

```
mcp__mnemosyne__assert_node(
  node_id="/pai/observation/bun-faster-than-npm",
  name="bun faster than npm for installs",
  description="bun install ~3s vs npm install ~30s for PAI tooling on macOS",
  node_type="/classifier/assertion/observation",
  epistemic_state="verified",
  scope="pai:memory",
  justification="empirical",
  provenance="benchmarked 2026-05-26 macOS 15.5"
)
```

### Node ID conventions

- Always start with `/`. Cayley node IDs are paths.
- Use kebab-case for the leaf.
- Prefix by scope/domain: `/pai/observation/...`, `/pai/decision/...`, `/pai/knowledge/people/...`, `/pai/project/foo/finding/...`.
- Keep IDs stable — they're how edges reference nodes. Renaming requires re-asserting all incoming edges.

## Assert an edge — template

```
mcp__mnemosyne__assert_edge(
  subject_id="/pai/observation/bun-faster-than-npm",
  predicate="/epistemology/edge/supports",
  object_id="/pai/decision/use-bun-over-npm",
  direction="forward",
  weight=0.9,
  epistemic_state="putative",
  scope="pai:memory",
  provenance="benchmark + standing PAI convention"
)
```

| Parameter | Notes |
|---|---|
| `direction` | `forward` (default) for asymmetric "A → B"; `bidirectional` for symmetric (analogous_to, co_occurs_with); `reverse` is rare. |
| `weight` | 0.0–1.0. Start at 1.0 for direct observation, 0.6–0.8 for inference, drop based on PredictiveRecord outcomes over time. |
| `epistemic_state` | The edge itself can be verified, contested, debunked. Default `putative`. |

The edge gets a deterministic SHA1 instance ID computed from `(subject, predicate, object)` — re-asserting the same edge with new metadata updates in place, no duplicates.

## Common edge predicates

| Predicate | Direction | Meaning |
|---|---|---|
| `/epistemology/edge/supports` | forward | evidence → assertion |
| `/epistemology/edge/contradicts` | forward | evidence → assertion |
| `/epistemology/edge/derives_from` | forward | child → parent (provenance / lineage) |
| `/epistemology/edge/emerged_from` | forward | emergent → parents (two or more) |
| `/epistemology/edge/predicts` | forward | model → testable_prediction |
| `/classifier/relationship/causal` | forward | A causes B |
| `/classifier/relationship/structural` | bidirectional | composition, taxonomy |
| `/classifier/relationship/temporal` | forward | before/after |
| `/classifier/relationship/epistemic` | forward | meta-claim about a claim |
| `/classifier/relationship/analogical` | bidirectional | same structure, different vocabularies |

## Anti-patterns

- **Asserting without scope.** Every claim holds in some context. Default to `pai:memory` if you don't know — never leave scope blank.
- **Marking something `verified` based on one source.** That's `putative` at best. Verified requires independent confirmation OR a positive prediction record.
- **Deleting `debunked` nodes.** Preserve them with all their incoming edges intact — that history is how the graph learns over time.
- **Using `fictional` outside a narrative scope.** If you mean "made up but referenced," that's `putative` with provenance noting the source. `fictional` is reserved for in-narrative truth.
- **Re-asserting markdown content as graph nodes inline.** Migration handles `MEMORY/KNOWLEDGE/*.md`. Use `assert_node` for inline observations the user gives you in the conversation — not to mirror files.

## Coordination tasks are nodes too

A task is just a node whose `epistemic_state` IS its lifecycle:

| State | Lifecycle meaning |
|---|---|
| `speculative` | Planned, waiting for dependencies or dispatch |
| `putative` | In progress, an agent has picked it up |
| `verified` | Done, output committed |
| `contested` | Output produced but under review |
| `debunked` | Agent reported failure |

Use `task_create` / `task_update` / `task_ready` instead of `assert_node` / `assert_edge` for coordination work — the dedicated tools encode the right defaults.
