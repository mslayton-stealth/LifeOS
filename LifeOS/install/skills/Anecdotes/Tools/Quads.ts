/**
 * Quads — convert validated AnecdoteCandidates to Cayley quad payloads.
 *
 * Anecdote node IDs are SHA1-deterministic on `contributor_slug | source_excerpt[:200]`
 * so re-running extraction on the same input produces the same node — idempotent.
 *
 * Ported from src/anecdotes/extract.py (build_anecdote_quads + build_contributor_quads).
 */

import { createHash } from "node:crypto";
import type { Quad } from "./CayleyClient";
import type { AnecdoteCandidate } from "./Extract";

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function slugify(text: string, maxLen = 60): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, maxLen).replace(/-+$/, "");
}

export function anecdoteNodeId(
  contributorSlug: string,
  title: string,
  sourceExcerpt: string,
): string {
  const hash = createHash("sha1")
    .update(`${contributorSlug}|${sourceExcerpt.slice(0, 200)}`)
    .digest("hex")
    .slice(0, 12);
  const titleSlug = slugify(title, 40);
  return `/anecdote/anecdote/${contributorSlug}/${titleSlug}_${hash}`;
}

export function utteranceNodeId(anecdoteId: string, ordinal: number): string {
  return `${anecdoteId}/utterance/${String(ordinal).padStart(3, "0")}`;
}

/** Cayley string literal: wrap in double quotes; strip CRLF; escape inner quotes. */
function quote(s: string): string {
  const cleaned = s.replace(/\r/g, " ").replace(/\n/g, " ").replace(/"/g, "'");
  return `"${cleaned}"`;
}

export type BuildOpts = {
  contributorId: string;
  scope?: string;
  epistemicState?: string;
  timestamp?: string;
  extractionRunId?: string;
};

export function buildAnecdoteQuads(
  candidate: AnecdoteCandidate,
  opts: BuildOpts,
): { id: string; quads: Quad[] } {
  const scope = opts.scope ?? "anecdotes:prototype";
  const epistemicState = opts.epistemicState ?? "putative";
  const when = opts.timestamp ?? nowIso();
  const extractionRunId = opts.extractionRunId ?? "";

  const contributorSlug =
    opts.contributorId.split("/").filter(Boolean).pop() ?? "unknown";
  const id = anecdoteNodeId(
    contributorSlug,
    candidate.title,
    candidate.source_excerpt,
  );
  const stateNode = `/epistemology/${epistemicState}`;
  const scopeNode = `/epistemology/scope/${scope.replace(/:/g, "_")}`;
  const modalityNode = `/anecdote/modality/${candidate.modality}`;

  const provenanceParts: string[] = [];
  if (extractionRunId) provenanceParts.push(`extraction:${extractionRunId}`);
  provenanceParts.push(`contributor=${opts.contributorId}`);
  const provenance = provenanceParts.join("|");

  const quads: Quad[] = [
    { subject: id, predicate: "/type/object/type", object: "/anecdote/anecdote" },
    { subject: id, predicate: "/type/object/name", object: quote(candidate.title) },
    { subject: id, predicate: "/anecdote/anecdote/setup", object: quote(candidate.setup) },
    {
      subject: id,
      predicate: "/anecdote/anecdote/complication",
      object: quote(candidate.complication),
    },
    {
      subject: id,
      predicate: "/anecdote/anecdote/resolution",
      object: quote(candidate.resolution),
    },
    { subject: id, predicate: "/anecdote/anecdote/insight", object: quote(candidate.insight) },
    {
      subject: id,
      predicate: "/anecdote/anecdote/insight_explicit",
      object: quote(candidate.insight_explicit ? "true" : "false"),
    },
    { subject: id, predicate: "/anecdote/edge/has_modality", object: modalityNode },
    {
      subject: id,
      predicate: "/anecdote/edge/contributed_by",
      object: opts.contributorId,
    },
    {
      subject: id,
      predicate: "/anecdote/edge/source_text",
      object: quote(candidate.source_excerpt),
    },
    { subject: id, predicate: "/epistemology/edge/has_state", object: stateNode },
    { subject: id, predicate: "/epistemology/edge/scoped_to", object: scopeNode },
    {
      subject: id,
      predicate: "/epistemology/edge/justification_type",
      object: "/epistemology/testimonial",
    },
    {
      subject: id,
      predicate: "/epistemology/edge/provenance",
      object: quote(provenance),
    },
    { subject: id, predicate: "/epistemology/edge/written_at", object: quote(when) },
  ];

  for (const d of candidate.domains) {
    if (d === "other") continue;
    quads.push({
      subject: id,
      predicate: "/anecdote/edge/expertise_domain",
      object: `/anecdote/domain/${d}`,
    });
  }

  for (const tag of candidate.tags) {
    const tagId = `/anecdote/tag/${slugify(tag)}`;
    quads.push(
      { subject: tagId, predicate: "/type/object/type", object: "/anecdote/tag" },
      { subject: tagId, predicate: "/type/object/name", object: quote(tag) },
      { subject: id, predicate: "/anecdote/edge/has_tag", object: tagId },
    );
  }

  for (const char of candidate.characters) {
    const charId = `/anecdote/character/${slugify(char)}`;
    quads.push(
      { subject: charId, predicate: "/type/object/type", object: "/anecdote/character" },
      { subject: charId, predicate: "/type/object/name", object: quote(char) },
      { subject: id, predicate: "/anecdote/edge/mentions_character", object: charId },
    );
  }

  if (candidate.modality === "dialectic") {
    for (const u of candidate.utterances) {
      const uid = utteranceNodeId(id, u.ordinal);
      quads.push(
        { subject: uid, predicate: "/type/object/type", object: "/anecdote/utterance" },
        { subject: uid, predicate: "/anecdote/utterance/speaker", object: quote(u.speaker) },
        {
          subject: uid,
          predicate: "/anecdote/utterance/ordinal",
          object: quote(String(u.ordinal)),
        },
        { subject: uid, predicate: "/anecdote/utterance/text", object: quote(u.text) },
        { subject: id, predicate: "/anecdote/edge/has_utterance", object: uid },
      );
    }
  }

  return { id, quads };
}

export type ContributorStatus = "active" | "withdrawn" | "historical";

export function buildContributorQuads(opts: {
  contributorSlug: string;
  name: string;
  status?: ContributorStatus;
  domains?: string[];
  timestamp?: string;
}): { id: string; quads: Quad[] } {
  const status = opts.status ?? "historical";
  if (!["active", "withdrawn", "historical"].includes(status)) {
    throw new Error(`invalid contributor status ${JSON.stringify(status)}`);
  }
  const when = opts.timestamp ?? nowIso();
  const id = `/anecdote/contributor/${opts.contributorSlug}`;
  const quads: Quad[] = [
    { subject: id, predicate: "/type/object/type", object: "/anecdote/contributor" },
    { subject: id, predicate: "/anecdote/contributor/name", object: quote(opts.name) },
    {
      subject: id,
      predicate: "/anecdote/contributor/status",
      object: `/anecdote/contributor_status/${status}`,
    },
    { subject: id, predicate: "/epistemology/edge/written_at", object: quote(when) },
  ];
  for (const d of opts.domains ?? []) {
    if (d === "other") continue;
    quads.push({
      subject: id,
      predicate: "/anecdote/edge/expertise_domain",
      object: `/anecdote/domain/${d}`,
    });
  }
  return { id, quads };
}
