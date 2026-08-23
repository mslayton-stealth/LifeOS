# Schema Reference

The full predicate + modality + domain + edge vocabulary used by this pack. The source of truth is `Schemas/anecdotes.nq`; this doc reads it in human form.

## Top-level types

| Type | Purpose |
|---|---|
| `/anecdote/anecdote` | The story — root of the four-part shape |
| `/anecdote/modality` | Form of delivery (closed list of 5) |
| `/anecdote/utterance` | One turn in a dialectic anecdote |
| `/anecdote/contributor` | Person who contributed the story |
| `/anecdote/domain_expertise` | Field the anecdote applies within (extensible) |
| `/anecdote/tag` | Free-form keyword for retrieval |
| `/anecdote/character` | Named individual mentioned in the anecdote (distinct from contributor) |

## Anecdote properties

| Predicate | Type | Notes |
|---|---|---|
| `/anecdote/anecdote/setup` | literal | Situation establishment |
| `/anecdote/anecdote/complication` | literal | What went wrong / unexpected |
| `/anecdote/anecdote/resolution` | literal | What was done, outcome |
| `/anecdote/anecdote/insight` | literal | Portable heuristic |
| `/anecdote/anecdote/insight_explicit` | literal `"true"` / `"false"` | Honest flag — did the source say this, or did you infer it? |

Plus the standard Mnemosyne envelope (see `LifeOS/install/skills/Mnemosyne/References/SchemaGuide.md`):

| Predicate | Notes |
|---|---|
| `/type/object/type` | `/anecdote/anecdote` |
| `/type/object/name` | The title |
| `/epistemology/edge/has_state` | Usually `/epistemology/putative` for fresh asserts |
| `/epistemology/edge/scoped_to` | Default `/epistemology/scope/anecdotes_prototype` |
| `/epistemology/edge/justification_type` | Always `/epistemology/testimonial` for anecdotes (someone told the story) |
| `/epistemology/edge/provenance` | Extraction run + contributor metadata |
| `/epistemology/edge/written_at` | ISO-8601 UTC, stamped on every assert |

## Modalities (closed list — 5)

| Node ID | Use when |
|---|---|
| `/anecdote/modality/dictated` | Oral transcript, sometimes digressive |
| `/anecdote/modality/reflective` | Written autobiography / memoir |
| `/anecdote/modality/curated` | Polished personal narrative |
| `/anecdote/modality/dialectic` | Multi-speaker dialogue with knowledge construction |
| `/anecdote/modality/interview` | Live interview with a domain expert |

## Domain expertise (starter list — extensible)

| Node ID | Domain |
|---|---|
| `/anecdote/domain/talent_agent` | Talent representation, booking, deals |
| `/anecdote/domain/tour_management` | Touring logistics, production |
| `/anecdote/domain/lighting_design` | Stage and event lighting |
| `/anecdote/domain/sound_engineering` | Audio engineering, FOH, monitoring |
| `/anecdote/domain/journalism` | Reporting, investigative |
| `/anecdote/domain/civic_life` | Public service, civic engagement |
| `/anecdote/domain/physics` | Physics — research, teaching, practice |
| `/anecdote/domain/mathematics` | Pure or applied mathematics |
| `/anecdote/domain/software_engineering` | Software construction |
| `/anecdote/domain/other` | Catch-all — add a specific domain by extending the schema |

To add a new domain, append to `~/.claude/skills/Anecdotes/Schemas/anecdotes.nq`:

```nq
</anecdote/domain/your_domain> </type/object/type> </anecdote/domain_expertise> .
</anecdote/domain/your_domain> </type/object/name> "your_domain" .
</anecdote/domain/your_domain> </common/topic/description> "What this domain covers." .
```

Then re-seed: `bun ~/.claude/skills/Anecdotes/Tools/SeedSchema.ts`. Update the closed list in `Tools/Prompts.ts` so the LLM is told the new domain is allowed.

## Contributor status enumeration

| Node ID | Meaning |
|---|---|
| `/anecdote/contributor_status/active` | Living, currently contributing |
| `/anecdote/contributor_status/withdrawn` | Opted out; anecdotes decommissioned but preserved for provenance |
| `/anecdote/contributor_status/historical` | Public-domain or fair-use corpus contributor (no living party) |

## Utterance (for dialectic modality only)

| Predicate | Notes |
|---|---|
| `/anecdote/utterance/speaker` | Speaker name (literal string) |
| `/anecdote/utterance/ordinal` | 0-indexed position (literal string of int — e.g. `"0"`, `"1"`) |
| `/anecdote/utterance/text` | The utterance content |

Utterance node IDs: `<anecdote_node_id>/utterance/<ordinal:003d>` — e.g. `/anecdote/anecdote/.../dialectic-arc_xyz/utterance/000`.

## Edge predicates

| Edge | Direction | Use |
|---|---|---|
| `/anecdote/edge/contributed_by` | anecdote → contributor | Author |
| `/anecdote/edge/has_modality` | anecdote → modality | Form classification |
| `/anecdote/edge/expertise_domain` | anecdote → domain (or contributor → domain) | Field classification |
| `/anecdote/edge/has_utterance` | anecdote → utterance | Dialectic-only ordered turns |
| `/anecdote/edge/source_text` | anecdote → literal | Citation / verbatim source |
| `/anecdote/edge/has_tag` | anecdote → tag | Free-form keyword |
| `/anecdote/edge/mentions_character` | anecdote → character | Named individual in the story |

## Node ID conventions

| Type | Pattern | Example |
|---|---|---|
| Anecdote | `/anecdote/anecdote/<contributor-slug>/<title-slug>_<sha1-12>` | `/anecdote/anecdote/franklin/the-water-american_abc123def456` |
| Utterance | `<anecdote-id>/utterance/<ordinal-003d>` | `/anecdote/anecdote/.../knuth-arc_xyz/utterance/007` |
| Contributor | `/anecdote/contributor/<slug>` | `/anecdote/contributor/franklin` |
| Tag | `/anecdote/tag/<slug>` | `/anecdote/tag/temperance` |
| Character | `/anecdote/character/<slug>` | `/anecdote/character/john-watts` |

The anecdote SHA1 prefix is `hash(contributor_slug | source_excerpt[:200])`. Same input = same ID. Re-extraction is idempotent.

## Default scope

`/epistemology/scope/anecdotes_prototype` (literal name `anecdotes:prototype`).

Partition by adding sub-scopes per corpus: `anecdotes:prototype:franklin`, `anecdotes:prototype:twain`, etc. Append to `Schemas/anecdotes.nq` or extend at runtime via direct quad writes.

## What's intentionally missing

The upstream private stack has additional types this prototype omits:

- `/anecdote/consent_terms` and consent presets (`public_domain`, `fair_use_research`, `explicit_v1`)
- `/anecdote/use_event` + payout fields
- `/anecdote/consumer` (consumer entities)
- `/anecdote/edge/consent_under`, `/anecdote/edge/used_in`, `/anecdote/edge/billed_to`
- Contributor `payout_address`

If you need any of those, you'll need to add them yourself or graduate to a future `AnecdotesCommons` skill. This prototype is intentionally substrate-only.
