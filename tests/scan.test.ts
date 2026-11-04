import { describe, expect, it } from "vitest";
import { createHeliusClient, type FetchFn } from "../src/helius.js";
import { scanHistory } from "../src/scan.js";

const ADDRESS = "GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52";
const PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ITEM = { signature: "sig1" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("scanHistory pagination", () => {
  it("calls twice and merges an empty first page with a later match", async () => {
    const bodies: unknown[] = [];
    const fetchFn: FetchFn = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return jsonResponse({
          data: [],
          paginationToken: "1:0",
          scan: {
            stoppedOn: "budget",
            scannedTransactions: 2000,
            matchedTransactions: 0,
            creditsCharged: 12,
          },
        });
      }
      return jsonResponse({
        data: [ITEM],
        scan: {
          stoppedOn: "windowEnd",
          scannedTransactions: 400,
          matchedTransactions: 1,
          creditsCharged: 10,
        },
      });
    };

    const client = createHeliusClient({ apiKey: "test-key", fetchFn });
    const merged = await scanHistory(client, {
      address: ADDRESS,
      match: { programs: [{ programId: PROGRAM }] },
    });

    expect(bodies).toHaveLength(2);
    expect((bodies[1] as { paginationToken?: string }).paginationToken).toBe("1:0");
    expect(merged.data).toEqual([ITEM]);
    expect(merged.pages).toBe(2);
    expect(merged.scan.creditsCharged).toBe(22);
    expect(merged.scan.scannedTransactions).toBe(2400);
    expect(merged.scan.matchedTransactions).toBe(1);
    expect(merged.scan.stoppedOn).toBe("windowEnd");
    expect(merged.stoppedReason).toBe("complete");
    expect(merged.paginationToken).toBeUndefined();
  });

  it("stops at maxPages=1 leaving the pagination token", async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls += 1;
      return jsonResponse({
        data: [],
        paginationToken: "9:9",
        scan: {
          stoppedOn: "budget",
          scannedTransactions: 1000,
          matchedTransactions: 0,
          creditsCharged: 11,
        },
      });
    };
    const client = createHeliusClient({ apiKey: "test-key", fetchFn });
    const merged = await scanHistory(client, {
      address: ADDRESS,
      match: { programs: [{ programId: PROGRAM }] },
      maxPages: 1,
    });
    expect(calls).toBe(1);
    expect(merged.pages).toBe(1);
    expect(merged.paginationToken).toBe("9:9");
    expect(merged.stoppedReason).toBe("maxPages");
  });

  it("stops before exceeding creditCap", async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls += 1;
      return jsonResponse({
        data: [],
        paginationToken: "1:0",
        scan: {
          stoppedOn: "budget",
          scannedTransactions: 2000,
          matchedTransactions: 0,
          creditsCharged: 12,
        },
      });
    };
    const client = createHeliusClient({ apiKey: "test-key", fetchFn });
    const merged = await scanHistory(client, {
      address: ADDRESS,
      match: { programs: [{ programId: PROGRAM }] },
      creditCap: 20,
    });
    expect(calls).toBe(1);
    expect(merged.pages).toBe(1);
    expect(merged.stoppedReason).toBe("creditCap");
    expect(merged.paginationToken).toBe("1:0");
    expect(merged.scan.creditsCharged).toBe(12);
  });
});
