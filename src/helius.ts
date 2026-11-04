import {
  CREDIT_BASE,
  CREDIT_PER_PAGE,
  HELIUS_HOST,
  SCAN_PATH,
  TOKEN_DISCRIMINATORS,
} from "./constants.js";
import { ScanBodySchema, ScanPageSchema, isRecord, type ProgramMatch, type ScanBody, type ScanPage } from "./schemas.js";

export type FetchFn = typeof fetch;

export class HeliusError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(redactSecret(body));
    this.name = "HeliusError";
    this.status = status;
    this.body = body;
  }
}

export type HeliusClient = {
  scan: (body: ScanBody) => Promise<ScanPage>;
  rpc: (method: string, params: unknown[]) => Promise<unknown>;
};

const MAX_ATTEMPTS = 3;

export function redactSecret(text: string): string {
  return text.replace(/api-key=[^&\s"'\\]+/gi, "api-key=REDACTED");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetwork(err: unknown): boolean {
  if (err instanceof HeliusError) return false;
  return true;
}

function programsNeedDiscriminatorFallback(programs: ProgramMatch[]): boolean {
  return programs.some((p) => (p.instructions?.length ?? 0) > 0 && (p.discriminators?.length ?? 0) === 0);
}

function withDiscriminatorFallback(body: ScanBody): ScanBody {
  const programs = body.match.programs;
  if (!programs) return body;
  return {
    ...body,
    match: {
      ...body.match,
      programs: programs.map((p) => ({
        programId: p.programId,
        discriminators: [...TOKEN_DISCRIMINATORS],
        scope: p.scope,
      })),
    },
  };
}

export function createHeliusClient(opts: { apiKey: string; fetchFn?: FetchFn }): HeliusClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const scanUrl = `${HELIUS_HOST}${SCAN_PATH}?api-key=${opts.apiKey}`;
  const rpcUrl = `${HELIUS_HOST}/?api-key=${opts.apiKey}`;

  async function postJson(url: string, payload: unknown): Promise<unknown> {
    let lastNetwork: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        if (res.status === 400) {
          throw new HeliusError(400, text);
        }
        if (res.status === 500) {
          throw new HeliusError(500, text);
        }
        if (res.status === 503) {
          if (attempt === MAX_ATTEMPTS - 1) {
            throw new HeliusError(503, text);
          }
          await sleep(100 * 2 ** attempt);
          continue;
        }
        if (!res.ok) {
          throw new HeliusError(res.status, text);
        }
        if (text.length === 0) return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new Error(redactSecret(`invalid JSON response: ${text.slice(0, 200)}`));
        }
      } catch (err) {
        if (err instanceof HeliusError) throw err;
        lastNetwork = err;
        if (attempt === MAX_ATTEMPTS - 1 || !isRetryableNetwork(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(redactSecret(msg));
        }
        await sleep(100 * 2 ** attempt);
      }
    }
    const msg = lastNetwork instanceof Error ? lastNetwork.message : "request failed";
    throw new Error(redactSecret(msg));
  }

  async function scanOnce(body: ScanBody): Promise<ScanPage> {
    const parsedBody = ScanBodySchema.parse(body);
    const raw = await postJson(scanUrl, parsedBody);
    return ScanPageSchema.parse(raw);
  }

  return {
    async scan(body: ScanBody): Promise<ScanPage> {
      try {
        return await scanOnce(body);
      } catch (err) {
        const programs = body.match.programs;
        if (
          err instanceof HeliusError &&
          err.status === 400 &&
          /instruction/i.test(err.body) &&
          programs &&
          programsNeedDiscriminatorFallback(programs)
        ) {
          return await scanOnce(withDiscriminatorFallback(body));
        }
        throw err;
      }
    },

    async rpc(method: string, params: unknown[]): Promise<unknown> {
      const raw = await postJson(rpcUrl, {
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      });
      if (!isRecord(raw)) {
        throw new Error("invalid rpc response");
      }
      if ("error" in raw && raw.error !== undefined && raw.error !== null) {
        const errText = typeof raw.error === "string" ? raw.error : JSON.stringify(raw.error);
        throw new Error(redactSecret(errText));
      }
      return raw.result;
    },
  };
}

export function estimatedScanCredits(pages: number): number {
  return CREDIT_BASE + CREDIT_PER_PAGE * Math.max(pages, 1);
}
