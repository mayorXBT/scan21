import { describe, expect, it } from "vitest";
import { joinExposures, type HistoryTx, type LiveDelegate } from "../src/audit.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WALLET = "So11111111111111111111111111111111111111112";
const ACCOUNT_LIVE = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ACCOUNT_DORMANT = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ACCOUNT_REVOKED = "11111111111111111111111111111111";
const DELEGATE = "ComputeBudget111111111111111111111111111111";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function approveTx(opts: {
  signature: string;
  source: string;
  delegate: string;
  blockTime: number;
  slot?: number;
  checked?: boolean;
}): HistoryTx {
  const name = opts.checked ? "approve_checked" : "approve";
  const rawAccounts = opts.checked
    ? [opts.source, MINT, opts.delegate, WALLET]
    : [opts.source, opts.delegate, WALLET];
  return {
    signature: opts.signature,
    slot: opts.slot ?? 10,
    blockTime: opts.blockTime,
    instructions: [
      {
        programId: TOKEN_PROGRAM,
        instructionName: name,
        decodedArgs: { amount: "1" },
        decodedAccounts: [
          { name: "source", pubkey: opts.source },
          { name: "delegate", pubkey: opts.delegate },
        ],
        rawAccounts,
        rawData: null,
      },
    ],
  };
}

function setAuthorityTx(opts: {
  signature: string;
  account: string;
  authorityType: string | number;
  blockTime: number;
}): HistoryTx {
  return {
    signature: opts.signature,
    slot: 11,
    blockTime: opts.blockTime,
    instructions: [
      {
        programId: TOKEN_PROGRAM,
        instructionName: "set_authority",
        decodedArgs: { authorityType: opts.authorityType, newAuthority: DELEGATE },
        decodedAccounts: [{ name: "account", pubkey: opts.account }],
        rawAccounts: [opts.account, WALLET],
        rawData: null,
      },
    ],
  };
}

describe("joinExposures", () => {
  const liveHigh: LiveDelegate = {
    tokenAccount: ACCOUNT_LIVE,
    mint: MINT,
    owner: WALLET,
    programId: TOKEN_PROGRAM,
    delegate: DELEGATE,
    delegatedAmount: 50n,
    balance: 100n,
  };
  const liveMedium: LiveDelegate = {
    tokenAccount: ACCOUNT_DORMANT,
    mint: MINT,
    owner: WALLET,
    programId: TOKEN_PROGRAM,
    delegate: DELEGATE,
    delegatedAmount: 50n,
    balance: 0n,
  };

  const history: HistoryTx[] = [
    approveTx({ signature: "grant-high", source: ACCOUNT_LIVE, delegate: DELEGATE, blockTime: 200, slot: 20 }),
    approveTx({ signature: "grant-dormant", source: ACCOUNT_DORMANT, delegate: DELEGATE, blockTime: 150 }),
    approveTx({ signature: "old-revoke", source: ACCOUNT_REVOKED, delegate: DELEGATE, blockTime: 50 }),
    setAuthorityTx({ signature: "owner-change", account: ACCOUNT_REVOKED, authorityType: "AccountOwner", blockTime: 80 }),
    setAuthorityTx({ signature: "mint-auth", account: MINT, authorityType: "MintTokens", blockTime: 90 }),
  ];

  it("flags HIGH vs MEDIUM vs INFO vs set_authority HIGH", () => {
    const exposures = joinExposures({ liveDelegates: [liveHigh, liveMedium], history });

    const high = exposures.filter((e) => e.kind === "live_delegate" && e.risk === "HIGH");
    expect(high).toHaveLength(1);
    expect(high[0]?.tokenAccount).toBe(ACCOUNT_LIVE);
    expect(high[0]?.signature).toBe("grant-high");
    expect(high[0]?.amountAtRisk).toBe(50n);

    const medium = exposures.filter((e) => e.kind === "live_delegate" && e.risk === "MEDIUM");
    expect(medium).toHaveLength(1);
    expect(medium[0]?.tokenAccount).toBe(ACCOUNT_DORMANT);

    const info = exposures.filter((e) => e.kind === "revoked_approve" && e.risk === "INFO");
    expect(info.some((e) => e.signature === "old-revoke")).toBe(true);

    const ownerChanges = exposures.filter((e) => e.kind === "set_authority" && e.risk === "HIGH");
    expect(ownerChanges).toHaveLength(1);
    expect(ownerChanges[0]?.signature).toBe("owner-change");

    expect(exposures.some((e) => e.signature === "mint-auth")).toBe(false);
  });

  it("records grantedVia from the lookup map", () => {
    const exposures = joinExposures({
      liveDelegates: [liveHigh],
      history: [approveTx({ signature: "grant-high", source: ACCOUNT_LIVE, delegate: DELEGATE, blockTime: 200 })],
      grantedViaBySignature: { "grant-high": "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" },
    });
    expect(exposures[0]?.grantedVia).toBe("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
  });

  it("classifies approve and account-owner set_authority from instruction data bytes", () => {
    const live: LiveDelegate = {
      tokenAccount: ACCOUNT_LIVE,
      mint: MINT,
      owner: WALLET,
      programId: TOKEN_PROGRAM,
      delegate: DELEGATE,
      delegatedAmount: 1n,
      balance: 2n,
    };
    const approveData = Buffer.from([4]).toString("hex");
    const ownerChangeData = Buffer.from([6, 2, 1]).toString("hex");
    const exposures = joinExposures({
      liveDelegates: [live],
      history: [
        {
          signature: "disc-approve",
          slot: 1,
          blockTime: 1,
          instructions: [
            {
              programId: TOKEN_PROGRAM,
              instructionName: null,
              decodedArgs: null,
              decodedAccounts: [],
              rawAccounts: [ACCOUNT_LIVE, DELEGATE, WALLET],
              rawData: approveData,
            },
          ],
        },
        {
          signature: "disc-owner",
          slot: 2,
          blockTime: 2,
          instructions: [
            {
              programId: TOKEN_PROGRAM,
              instructionName: null,
              decodedArgs: null,
              decodedAccounts: [],
              rawAccounts: [ACCOUNT_REVOKED, WALLET],
              rawData: ownerChangeData,
            },
          ],
        },
      ],
    });
    expect(exposures.some((e) => e.kind === "live_delegate" && e.signature === "disc-approve")).toBe(true);
    expect(exposures.some((e) => e.kind === "set_authority" && e.signature === "disc-owner")).toBe(true);
  });

  it("skips set_authority owner change on an account initialized in the same tx", () => {
    const newOwner = Buffer.alloc(32, 7);
    const data = Buffer.concat([Buffer.from([6, 2, 1]), newOwner]).toString("hex");
    const exposures = joinExposures({
      liveDelegates: [],
      wallet: WALLET,
      history: [
        {
          signature: "mint-flow",
          slot: 3,
          blockTime: 3,
          instructions: [
            {
              programId: TOKEN_PROGRAM,
              instructionName: "initialize_account_3",
              decodedArgs: null,
              decodedAccounts: [],
              rawAccounts: [ACCOUNT_REVOKED, MINT],
              rawData: Buffer.from([18]).toString("hex"),
            },
            {
              programId: TOKEN_PROGRAM,
              instructionName: "set_authority",
              decodedArgs: null,
              decodedAccounts: [],
              rawAccounts: [ACCOUNT_REVOKED, WALLET],
              rawData: data,
            },
          ],
        },
      ],
    });
    expect(exposures).toHaveLength(0);
  });

  it("flags a later owner change and reads the new authority from instruction data", () => {
    const newOwnerBytes = Buffer.alloc(32, 9);
    const data = Buffer.concat([Buffer.from([6, 2, 1]), newOwnerBytes]);
    const exposures = joinExposures({
      liveDelegates: [],
      wallet: WALLET,
      history: [
        {
          signature: "real-owner-change",
          slot: 4,
          blockTime: 4,
          instructions: [
            {
              programId: TOKEN_PROGRAM,
              instructionName: "set_authority",
              decodedArgs: null,
              decodedAccounts: [],
              rawAccounts: [ACCOUNT_REVOKED, WALLET],
              rawData: data.toString("hex"),
            },
          ],
        },
      ],
    });
    const ownerChanges = exposures.filter((e) => e.kind === "set_authority");
    expect(ownerChanges).toHaveLength(1);
    expect(ownerChanges[0]?.tokenAccount).toBe(ACCOUNT_REVOKED);
    expect(ownerChanges[0]?.delegate).toBeTruthy();
    expect(ownerChanges[0]?.owner).toBe(WALLET);
  });

  it("ignores non-token programs whose data starts with 0x06", () => {
    const exposures = joinExposures({
      liveDelegates: [],
      history: [
        {
          signature: "other-program",
          slot: 1,
          blockTime: 1,
          instructions: [
            {
              programId: "ComputeBudget111111111111111111111111111111",
              instructionName: null,
              decodedArgs: null,
              decodedAccounts: [],
              rawAccounts: [],
              rawData: Buffer.from([6, 2]).toString("hex"),
            },
          ],
        },
      ],
    });
    expect(exposures).toHaveLength(0);
  });
});
