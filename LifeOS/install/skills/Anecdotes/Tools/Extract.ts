/**
 * Extract — parse + validate an LLM response into AnecdoteCandidate objects.
 *
 * Tolerant of common LLM artifacts (markdown fences, leading prose).
 * Throws on invalid JSON or schema violations, with the candidate index
 * surfaced for fixable diffs.
 *
 * Ported from src/anecdotes/extract.py (parse_candidates + _validate_candidate).
 */

import { DOMAINS, MODALITIES, type Domain, type Modality } from "./Prompts";

const VALID_MODALITIES = new Set<string>(MODALITIES);
const VALID_DOMAINS = new Set<string>([...DOMAINS, "other"]);

const REQUIRED_FIELDS = [
  "title",
  "modality",
  "setup",
  "complication",
  "resolution",
  "insight",
  "insight_explicit",
  "characters",
  "tags",
  "domains",
  "source_excerpt",
] as const;

export type Utterance = {
  speaker: string;
  ordinal: number;
  text: string;
};

export type AnecdoteCandidate = {
  title: string;
  modality: Modality;
  setup: string;
  complication: string;
  resolution: string;
  insight: string;
  insight_explicit: boolean;
  characters: string[];
  tags: string[];
  domains: Domain[];
  source_excerpt: string;
  utterances: Utterance[];
};

export function parseCandidates(llmResponse: string): AnecdoteCandidate[] {
  const cleaned = stripLlmArtifacts(llmResponse);
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM response is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(
      `Expected JSON array of candidates, got ${typeof data}`,
    );
  }
  const candidates: AnecdoteCandidate[] = [];
  for (let i = 0; i < data.length; i++) {
    const raw = data[i];
    if (typeof raw !== "object" || raw === null) {
      throw new Error(
        `Candidate #${i}: expected JSON object, got ${typeof raw}`,
      );
    }
    try {
      candidates.push(validateCandidate(raw as Record<string, unknown>));
    } catch (e) {
      const title = (raw as Record<string, unknown>).title ?? "?";
      throw new Error(
        `Candidate #${i} (${JSON.stringify(title)}): ${(e as Error).message}`,
      );
    }
  }
  return candidates;
}

const FENCE_RE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;

function stripLlmArtifacts(text: string): string {
  let t = text.trim();
  const m = FENCE_RE.exec(t);
  if (m) t = m[1].trim();
  if (t.startsWith("Here is") || t.startsWith("Here are")) {
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "[" || t[i] === "{") {
        t = t.slice(i);
        break;
      }
    }
  }
  return t;
}

function validateCandidate(raw: Record<string, unknown>): AnecdoteCandidate {
  const missing = REQUIRED_FIELDS.filter((f) => !(f in raw));
  if (missing.length > 0) {
    throw new Error(`missing required fields: ${JSON.stringify(missing.sort())}`);
  }

  const modality = String(raw.modality);
  if (!VALID_MODALITIES.has(modality)) {
    throw new Error(
      `unknown modality ${JSON.stringify(modality)}; expected one of ${JSON.stringify([...VALID_MODALITIES].sort())}`,
    );
  }

  const title = requireStr(raw, "title").trim();
  if (!title) throw new Error("title cannot be empty");

  const domainsRaw = raw.domains;
  if (!Array.isArray(domainsRaw) || domainsRaw.length === 0) {
    throw new Error("domains must be a non-empty list");
  }
  const domains: Domain[] = [];
  for (const d of domainsRaw) {
    const ds = String(d);
    if (!VALID_DOMAINS.has(ds)) {
      throw new Error(
        `unknown domain ${JSON.stringify(ds)}; expected one of ${JSON.stringify([...VALID_DOMAINS].sort())}`,
      );
    }
    domains.push(ds as Domain);
  }

  const tagsRaw = raw.tags;
  if (!Array.isArray(tagsRaw) || tagsRaw.length === 0) {
    throw new Error("tags must be a non-empty list");
  }
  const tags = tagsRaw.map((t) => String(t).trim()).filter((t) => t.length > 0);

  const charactersRaw = raw.characters;
  if (!Array.isArray(charactersRaw)) {
    throw new Error("characters must be a list (may be empty)");
  }
  const characters = charactersRaw
    .map((c) => String(c).trim())
    .filter((c) => c.length > 0);

  let insightExplicit = raw.insight_explicit;
  if (typeof insightExplicit === "string") {
    const lower = insightExplicit.toLowerCase();
    insightExplicit = lower === "true" || lower === "yes" || lower === "1";
  }
  if (typeof insightExplicit !== "boolean") {
    throw new Error("insight_explicit must be a boolean");
  }

  const utterancesRaw = (raw.utterances as unknown[] | undefined) ?? [];
  const utterances: Utterance[] = [];
  if (modality === "dialectic") {
    if (!Array.isArray(utterancesRaw) || utterancesRaw.length === 0) {
      throw new Error(
        "dialectic candidates require non-empty utterances list",
      );
    }
    for (let j = 0; j < utterancesRaw.length; j++) {
      const u = utterancesRaw[j];
      if (typeof u !== "object" || u === null) {
        throw new Error(`utterance #${j}: not an object`);
      }
      const obj = u as Record<string, unknown>;
      const speaker = String(obj.speaker ?? "").trim();
      const text = String(obj.text ?? "").trim();
      if (!speaker || !text) {
        throw new Error(`utterance #${j}: speaker and text required`);
      }
      let ordinal = obj.ordinal ?? j;
      if (typeof ordinal !== "number") {
        const parsed = Number(ordinal);
        if (Number.isNaN(parsed)) {
          throw new Error(`utterance #${j}: ordinal must be int`);
        }
        ordinal = parsed;
      }
      utterances.push({ speaker, ordinal: ordinal as number, text });
    }
  }
  // Non-dialectic with utterances → drop silently.

  return {
    title,
    modality: modality as Modality,
    setup: requireStr(raw, "setup").trim(),
    complication: requireStr(raw, "complication").trim(),
    resolution: requireStr(raw, "resolution").trim(),
    insight: requireStr(raw, "insight").trim(),
    insight_explicit: insightExplicit as boolean,
    characters,
    tags,
    domains,
    source_excerpt: requireStr(raw, "source_excerpt").trim(),
    utterances,
  };
}

function requireStr(d: Record<string, unknown>, key: string): string {
  const v = d[key];
  if (typeof v !== "string") {
    throw new Error(`${JSON.stringify(key)} must be a string, got ${typeof v}`);
  }
  return v;
}
