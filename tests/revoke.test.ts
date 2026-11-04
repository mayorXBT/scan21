import { Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { TOKEN_PROGRAM_ID } from "../src/constants.js";
import { createHeliusClient, type FetchFn } from "../src/helius.js";
import { buildRevokeTransaction, createRevokeTxBase64 } from "../src/revoke.js";

const OWNER = "So11111111111111111111111111111111111111112";
const SOURCE = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("revoke transaction", () => {
  it("encodes instruction data byte 5 with source then owner", () => {
    const b64 = buildRevokeTransaction({
      feePayer: OWNER,
      recentBlockhash: BLOCKHASH,
      targets: [{ tokenAccount: SOURCE, owner: OWNER, programId: TOKEN_PROGRAM_ID }],
    });
    expect(b64.length).toBeGreaterThan(0);
    const tx = Transaction.from(Buffer.from(b64, "base64"));
    expect(tx.instructions).toHaveLength(1);
    const ix = tx.instructions[0];
    if (!ix) throw new Error("missing instruction");
    expect(ix.data[0]).toBe(5);
    expect(ix.keys[0]?.pubkey.toBase58()).toBe(SOURCE);
    expect(ix.keys[1]?.pubkey.toBase58()).toBe(OWNER);
  });

  it("builds a non-empty base64 tx from a mocked blockhash", async () => {
    const fetchFn: FetchFn = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string };
      if (body.method === "getLatestBlockhash") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: { value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1 } },
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    };
    const client = createHeliusClient({ apiKey: "test-key", fetchFn });
    const b64 = await createRevokeTxBase64(client, OWNER, [
      { tokenAccount: SOURCE, owner: OWNER, programId: TOKEN_PROGRAM_ID },
    ]);
    expect(b64.length).toBeGreaterThan(0);
    expect(() => Transaction.from(Buffer.from(b64, "base64"))).not.toThrow();
  });
});
