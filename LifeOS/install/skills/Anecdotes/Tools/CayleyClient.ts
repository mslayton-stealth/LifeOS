/**
 * CayleyClient — slim HTTP wrapper for Cayley's REST API.
 *
 * Vendored from the Mnemosyne pack (`LifeOS/install/skills/Mnemosyne/Tools/CayleyClient.ts`)
 * so this pack is self-contained at runtime. The two are functionally identical;
 * keep them in sync when patching.
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
  process.env.CAYLEY_BASE_URL ?? "http://localhost:64211";

const WRITE_ENDPOINT = "/api/v1/write";
const QUERY_GIZMO_ENDPOINT = "/api/v1/query/gizmo";

export class CayleyClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(baseUrl: string = DEFAULT_BASE_URL, timeoutMs = 30_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  async waitReady(maxWaitSeconds = 30, pollIntervalMs = 2_000): Promise<void> {
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

  async writeQuadsChunked(quads: Quad[], chunkSize = 500): Promise<number> {
    let total = 0;
    for (let i = 0; i < quads.length; i += chunkSize) {
      const chunk = quads.slice(i, i + chunkSize);
      await this.writeQuads(chunk);
      total += chunk.length;
    }
    return total;
  }

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

export function stripLiteralQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

export function escapeNodeId(nodeId: string): string {
  return nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
