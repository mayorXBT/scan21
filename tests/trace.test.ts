import { describe, expect, it } from "vitest";
import { NATIVE_SOL_MINT } from "../src/constants.js";
import { collectOutflows, groupOutflows } from "../src/trace.js";

const WALLET = "GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("outflow grouping", () => {
  it("groups outflows and ignores inflows", () => {
    const txs = [
      {
        signature: "sig-sol",
        parsed: {
          blockTime: 10,
          nativeTransfers: [
            { fromUserAccount: WALLET, toUserAccount: OTHER, amount: 5 },
            { fromUserAccount: OTHER, toUserAccount: WALLET, amount: 99 },
          ],
          tokenTransfers: [],
        },
      },
      {
        signature: "sig-token",
        parsed: {
          blockTime: 20,
          nativeTransfers: [{ fromUserAccount: WALLET, toUserAccount: OTHER, amount: 7 }],
          tokenTransfers: [
            {
              fromUserAccount: WALLET,
              toUserAccount: OTHER,
              mint: USDC,
              rawTokenAmount: "30",
            },
            {
              fromUserAccount: OTHER,
              toUserAccount: WALLET,
              mint: USDC,
              rawTokenAmount: "1000",
            },
          ],
        },
      },
    ];

    const outflows = collectOutflows(WALLET, txs);
    expect(outflows).toHaveLength(3);
    expect(outflows.every((o) => o.amount !== 99n && o.amount !== 1000n)).toBe(true);

    const grouped = groupOutflows(outflows);
    expect(grouped[0]?.mint).toBe(NATIVE_SOL_MINT);
    expect(grouped[0]?.total).toBe(12n);
    expect(grouped[0]?.txCount).toBe(2);
    expect(grouped[0]?.signatures).toEqual(["sig-sol", "sig-token"]);
    expect(grouped[1]?.mint).toBe(USDC);
    expect(grouped[1]?.total).toBe(30n);
  });
});
