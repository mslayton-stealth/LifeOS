/**
 * CayleyClient — HTTP wrapper for Cayley's REST API.
 *
 * Base URL defaults to CAYLEY_BASE_URL env var, falling back to localhost:64210.
 * All write operations verify CRLF-free content before sending — Cayley
 * silently fails on embedded \r.
 *
 * Ported from src/seed/cayley_client.py in the upstream mnemosyne stack.
 */

export type Quad = {
  subject: string;
  predicate: string;
  object: string;
  label?: string;
};

export type GizmoResult = { result?: unknown };

export class CayleyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CayleyError";
  }
}

const DEFAULT_BASE_URL =
  process.env.CAYLEY_BASE_URL ?? "http://localhost:64210";

const WRITE_ENDPOINT = "/api/v1/write";
const QUERY_GIZMO_ENDPOINT = "/api/v1/query/gizmo";

export class CayleyClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(baseUrl: string = DEFAULT_BASE_URL, timeoutMs = 30_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  // ── Health ──────────────────────────────────────────────────────────────

  /** Block until Cayley responds, or throw CayleyError on timeout. */
  async waitReady(maxWaitSeconds = 60, pollIntervalMs = 2_000): Promise<void> {
    const deadline = Date.now() + maxWaitSeconds * 1000;
    while (Date.now() < deadline) {
      try {
        const r = await this._fetch(QUERY_GIZMO_ENDPOINT, {
          method: "POST",
          body: "g.Vertex().GetLimit(1)",
          timeoutMs: 5_000,
        });
        if (r.status < 500) return;
      } catch {
        // connection refused — keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new CayleyError(
      `Cayley at ${this.baseUrl} did not become ready within ${maxWaitSeconds}s`,
    );
  }

  // ── Write ───────────────────────────────────────────────────────────────

  /** POST a list of quad dicts to Cayley. Returns parsed JSON response. */
  async writeQuads(quads: Quad[]): Promise<unknown> {
    assertNoCrlfInQuads(quads);
    const r = await this._fetch(WRITE_ENDPOINT, {
      method: "POST",
      body: JSON.stringify(quads),
      headers: { "Content-Type": "application/json" },
    });
    await this._raiseForStatus(r, "writeQuads");
    return r.json();
  }

  /** Write quads in chunks; returns total written count. */
  async writeQuadsChunked(quads: Quad[], chunkSize = 500): Promise<number> {
    let total = 0;
    for (let i = 0; i < quads.length; i += chunkSize) {
      const chunk = quads.slice(i, i + chunkSize);
      await this.writeQuads(chunk);
      total += chunk.length;
    }
    return total;
  }

  // ── Query ───────────────────────────────────────────────────────────────

  /** POST a Gizmo (JavaScript) query and return parsed result. */
  async queryGizmo(script: string): Promise<GizmoResult> {
    assertNoCrlfInString(script, "Gizmo script");
    const r = await this._fetch(QUERY_GIZMO_ENDPOINT, {
      method: "POST",
      body: script,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    await this._raiseForStatus(r, "queryGizmo");
    return (await r.json()) as GizmoResult;
  }

  /** Return true if the given node ID has any outgoing edges. */
  async nodeExists(nodeId: string): Promise<boolean> {
    const script = `g.V("${escapeNodeId(nodeId)}").Out().GetLimit(1)`;
    try {
      const r = await this.queryGizmo(script);
      const arr = (r.result as unknown[] | null) ?? [];
      return arr.length > 0;
    } catch {
      return false;
    }
  }

  /** Count nodes that have /type/object/type == typeId. */
  async countNodesOfType(typeId: string): Promise<number> {
    const script = `g.V("${escapeNodeId(typeId)}").In("/type/object/type").Count()`;
    const r = await this.queryGizmo(script);
    return coerceCount(r.result);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async _fetch(
    path: string,
    opts: {
      method: string;
      body?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? this.timeoutMs,
    );
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: opts.method,
        body: opts.body,
        headers: opts.headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }

  private async _raiseForStatus(r: Response, op: string): Promise<void> {
    if (!r.ok) {
      const body = await r.text();
      throw new CayleyError(
        `Cayley ${op} failed: HTTP ${r.status} — ${body.slice(0, 500)}`,
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Strip outer quotes from a Cayley string literal: `"foo"` → `foo`. */
export function stripLiteralQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/** Escape a node ID for embedding in a Gizmo script string literal. */
export function escapeNodeId(nodeId: string): string {
  return nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Cayley's Count() returns variable shapes; coerce to int. */
export function coerceCount(raw: unknown): number {
  if (Array.isArray(raw)) {
    if (raw.length === 0 || raw[0] == null) return 0;
    const first = raw[0];
    if (typeof first === "object" && first !== null && "count" in first) {
      return Number((first as { count: unknown }).count) || 0;
    }
    return Number(first) || 0;
  }
  return Number(raw) || 0;
}

function assertNoCrlfInQuads(quads: Quad[]): void {
  for (const q of quads) {
    for (const [k, v] of Object.entries(q)) {
      if (typeof v === "string" && v.includes("\r")) {
        throw new Error(
          `CRLF detected in quad field '${k}': ${JSON.stringify(v)}. ` +
            `Cayley requires Unix LF only.`,
        );
      }
    }
  }
}

function assertNoCrlfInString(s: string, label: string): void {
  if (s.includes("\r")) {
    throw new Error(`CRLF detected in ${label}. Cayley requires Unix LF only.`);
  }
}
