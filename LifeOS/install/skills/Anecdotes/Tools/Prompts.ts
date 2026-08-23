/**
 * LLM extraction prompt templates.
 *
 * Two templates:
 *   buildExtractionPrompt — for prose corpora
 *   buildDialecticPrompt  — for multi-speaker dialogue
 *
 * The prompt asks the LLM to emit a JSON array of anecdote candidates with
 * a strict schema. Extract.ts then validates the response.
 *
 * Ported from src/anecdotes/prompts.py.
 */

export const MODALITIES = [
  "dictated",
  "reflective",
  "curated",
  "dialectic",
  "interview",
] as const;
export type Modality = (typeof MODALITIES)[number];

export const DOMAINS = [
  "talent_agent",
  "tour_management",
  "lighting_design",
  "sound_engineering",
  "journalism",
  "civic_life",
  "physics",
  "mathematics",
  "software_engineering",
] as const;
export type Domain = (typeof DOMAINS)[number] | "other";

const EXTRACTION_PROMPT = `You are an expert anecdote extractor for the Mnemosyne-anecdotes platform.

Read the source text below carefully. Identify each discrete **anecdote** — a
self-contained story that carries an underlying heuristic or lesson, even if
the lesson is implicit. Skip pure exposition, editorial commentary unattached
to a story, and material that is purely descriptive.

For each anecdote you find, output a JSON object with these fields:

- \`title\`: short descriptive title (5-10 words, lowercase except proper nouns)
- \`modality\`: one of {modalities}.
  - dictated: oral, transcribed, sometimes digressive
  - reflective: written autobiography, often with explicit moral
  - curated: polished narrative where insight is implicit
  - dialectic: multi-speaker; use only for actual dialogue
  - interview: live-interview transcripts only — do not use for book corpora
- \`setup\`: 1-3 sentences establishing situation, who/where/when/stakes
- \`complication\`: 1-3 sentences on what went wrong, was unexpected, or unknown
- \`resolution\`: 1-3 sentences on what was actually done and outcome
- \`insight\`: 1-3 sentences naming the portable heuristic. If the source states
  it explicitly, quote/paraphrase it. If implicit, infer it concisely; signal
  this in \`insight_explicit\` below.
- \`insight_explicit\`: true if the original text labels the lesson explicitly,
  false if you inferred it.
- \`characters\`: array of named individuals (people, not abstract entities)
- \`tags\`: 3-5 keyword tags (lowercase, snake_case)
- \`domains\`: 1-2 from {domains}, or "other" if none fit
- \`source_excerpt\`: shortest contiguous substring of the source text that
  contains the core of the anecdote. Used for verification — must be quoted
  verbatim.

If the chunk contains no extractable anecdotes (pure exposition, editorial,
preface, etc.), output an empty JSON array \`[]\` with no commentary.

Output strict JSON only — no surrounding prose, no markdown fences, no commentary.

---
SOURCE_TEXT:
{source_text}
`;

const DIALECTIC_PROMPT = `You are an expert at extracting dialectic-modality anecdotes — those built
from multi-speaker conversation in which knowledge is constructed jointly
rather than recited.

Read the source dialogue below. Identify each discrete **knowledge-construction
arc**: a span of conversation in which an insight emerges from the back-and-forth
that no single speaker could have produced alone.

For each arc you find, output a JSON object with these fields:

- \`title\`: short descriptive title (5-10 words)
- \`modality\`: must be "dialectic"
- \`setup\`: 1-3 sentences naming the question or puzzle the speakers are facing
- \`complication\`: 1-3 sentences on the conceptual obstacle that forces dialogue
- \`resolution\`: 1-3 sentences on the structural insight the dialogue produces
- \`insight\`: 1-3 sentences naming the portable heuristic
- \`insight_explicit\`: true|false
- \`characters\`: array of speaker names
- \`tags\`: 3-5 keyword tags
- \`domains\`: 1-2 from {domains}, or "other"
- \`utterances\`: array of objects with fields:
  - \`speaker\`: name (must match one in \`characters\`)
  - \`ordinal\`: 0-indexed position within this arc
  - \`text\`: the utterance content (verbatim or near-verbatim)
- \`source_excerpt\`: shortest contiguous substring containing the arc

Output strict JSON only — no commentary, no markdown fences.

---
SOURCE_TEXT:
{source_text}
`;

export function buildExtractionPrompt(sourceText: string): string {
  return EXTRACTION_PROMPT.replace("{modalities}", MODALITIES.join(", "))
    .replace("{domains}", DOMAINS.join(", "))
    .replace("{source_text}", sourceText);
}

export function buildDialecticPrompt(sourceText: string): string {
  return DIALECTIC_PROMPT.replace("{domains}", DOMAINS.join(", ")).replace(
    "{source_text}",
    sourceText,
  );
}
