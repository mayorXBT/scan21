import {
  APPROVE_NAMES,
  COMPUTE_BUDGET_PROGRAM_ID,
  DEFAULT_CREDIT_CAP,
  DEFAULT_MAX_PAGES,
  ORB_TX_PREFIX,
  PAGE_COST_ESTIMATE,
  SET_AUTHORITY_NAMES,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_IDS,
} from "./constants.js";
import { formatCredits, formatUnix, markdownTable } from "./format.js";
import type { HeliusClient } from "./helius.js";
import { createRevokeTxBase64, type RevokeTarget } from "./revoke.js";
import { scanHistory } from "./scan.js";
import { isRecord, type AuditWalletInput, type ProgramMatch } from "./schemas.js";
import { getAllTokenAccounts } from "./token-accounts.js";
import {
  AUTH_ACCOUNT_OWNER,
  IX_APPROVE,
  IX_APPROVE_CHECKED,
  IX_INITIALIZE_ACCOUNT,
  IX_INITIALIZE_ACCOUNT2,
  IX_INITIALIZE_ACCOUNT3,
  IX_SET_AUTHORITY,
  newAuthorityFromData,
  setAuthorityType,
  tokenInstructionIndex,
} from "./token-ix.js";
import { TOKEN_PROGRAM_FILTERS } from "./token-filters.js";

export type LiveDelegate = {
  tokenAccount: string;
  mint: string;
  owner: string;
  programId: string;
  delegate: string;
  delegatedAmount: bigint;
  balance: bigint;
};

export type HistoryInstruction = {
  programId: string;
  instructionName: string | null;
  decodedArgs: Record<string, unknown> | null;
  decodedAccounts: { name: string | null; pubkey: string | null }[];
  rawAccounts: string[];
  rawData: string | null;
};

export type HistoryTx = {
  signature: string;
  slot: number | null;
  blockTime: number | null;
  instructions: HistoryInstruction[];
};

export type Risk = "HIGH" | "MEDIUM" | "INFO";

export type Exposure = {
  kind: "live_delegate" | "set_authority" | "revoked_approve";
  risk: Risk;
  mint: string | null;
  tokenAccount: string | null;
  delegate: string | null;
  amountAtRisk: bigint;
  grantedWhen: number | null;
  grantedVia: string | null;
  signature: string | null;
  slot: number | null;
  programId: string | null;
  owner: string | null;
};

function normName(name: string): string {
  return name.replace(/[_-]/g, "").toLowerCase();
}

const TOKEN_PROGRAM_SET = new Set<string>(TOKEN_PROGRAM_IDS);

function isTokenProgramIx(ix: HistoryInstruction): boolean {
  return TOKEN_PROGRAM_SET.has(ix.programId);
}

function isApprove(ix: HistoryInstruction): boolean {
  if (!isTokenProgramIx(ix)) return false;
  if (ix.instructionName !== null && APPROVE_NAMES.has(normName(ix.instructionName))) return true;
  const index = tokenInstructionIndex(ix.rawData);
  return index === IX_APPROVE || index === IX_APPROVE_CHECKED;
}

function isApproveChecked(ix: HistoryInstruction): boolean {
  if (!isTokenProgramIx(ix)) return false;
  if (ix.instructionName !== null && normName(ix.instructionName) === "approvechecked") return true;
  return tokenInstructionIndex(ix.rawData) === IX_APPROVE_CHECKED;
}

function isSetAuthority(ix: HistoryInstruction): boolean {
  if (!isTokenProgramIx(ix)) return false;
  if (ix.instructionName !== null && SET_AUTHORITY_NAMES.has(normName(ix.instructionName))) return true;
  return tokenInstructionIndex(ix.rawData) === IX_SET_AUTHORITY;
}

const INIT_ACCOUNT_NAMES = new Set([
  "initializeaccount",
  "initializeaccount2",
  "initializeaccount3",
  "initialize_account",
  "initialize_account_2",
  "initialize_account_3",
]);
const INIT_ACCOUNT_IX = new Set([
  IX_INITIALIZE_ACCOUNT,
  IX_INITIALIZE_ACCOUNT2,
  IX_INITIALIZE_ACCOUNT3,
]);

function isInitializeAccount(ix: HistoryInstruction): boolean {
  if (!isTokenProgramIx(ix)) return false;
  if (ix.instructionName !== null && INIT_ACCOUNT_NAMES.has(normName(ix.instructionName))) return true;
  const index = tokenInstructionIndex(ix.rawData);
  return index !== null && INIT_ACCOUNT_IX.has(index);
}

function namedAccount(ix: HistoryInstruction, ...names: string[]): string | null {
  const want = new Set(names.map(normName));
  for (const account of ix.decodedAccounts) {
    if (account.name && want.has(normName(account.name)) && account.pubkey) {
      return account.pubkey;
    }
  }
  return null;
}

function tokenAccountOf(ix: HistoryInstruction): string | null {
  return namedAccount(ix, "source", "account", "token", "tokenAccount") ?? ix.rawAccounts[0] ?? null;
}

function delegateOf(ix: HistoryInstruction): string | null {
  const named = namedAccount(ix, "delegate");
  if (named) return named;
  if (isApproveChecked(ix)) return ix.rawAccounts[2] ?? null;
  return ix.rawAccounts[1] ?? null;
}

function currentAuthorityOf(ix: HistoryInstruction): string | null {
  return namedAccount(ix, "authority", "currentAuthority", "owner") ?? ix.rawAccounts[1] ?? null;
}

function newAuthorityOf(ix: HistoryInstruction): string | null {
  return (
    namedAccount(ix, "newAuthority", "new_authority") ??
    newAuthorityFromData(ix.rawData) ??
    ix.rawAccounts[2] ??
    null
  );
}

function initializedAccounts(tx: HistoryTx): Set<string> {
  const accounts = new Set<string>();
  for (const ix of tx.instructions) {
    if (!isInitializeAccount(ix)) continue;
    const account = tokenAccountOf(ix);
    if (account) accounts.add(account);
  }
  return accounts;
}

function mintOf(tx: HistoryTx, ix: HistoryInstruction, tokenAccount: string | null): string | null {
  const named = namedAccount(ix, "mint");
  if (named) return named;
  if (!tokenAccount) return null;
  for (const other of tx.instructions) {
    if (!isInitializeAccount(other)) continue;
    if (tokenAccountOf(other) !== tokenAccount) continue;
    const mint = namedAccount(other, "mint") ?? other.rawAccounts[1] ?? null;
    if (mint) return mint;
  }
  return null;
}

function isOwnerAuthority(ix: HistoryInstruction): boolean {
  const args = ix.decodedArgs;
  if (args) {
    const raw = args.authorityType ?? args.authority_type;
    if (typeof raw === "number") return raw === AUTH_ACCOUNT_OWNER;
    if (typeof raw === "string") {
      const n = normName(raw);
      if (n === "owner" || n === "accountowner" || n === "2") return true;
      if (
        n === "minttokens" ||
        n === "freezeaccount" ||
        n === "closeaccount" ||
        n === "0" ||
        n === "1" ||
        n === "3"
      ) {
        return false;
      }
    }
  }
  return setAuthorityType(ix.rawData) === AUTH_ACCOUNT_OWNER;
}

function findGrant(history: HistoryTx[], live: LiveDelegate): HistoryTx | null {
  let best: HistoryTx | null = null;
  for (const tx of history) {
    const hit = tx.instructions.some((ix) => {
      if (!isApprove(ix)) return false;
      const source = tokenAccountOf(ix);
      const delegate = delegateOf(ix);
      return source === live.tokenAccount || delegate === live.delegate;
    });
    if (!hit) continue;
    if (!best) {
      best = tx;
      continue;
    }
    if ((tx.blockTime ?? -1) > (best.blockTime ?? -1)) best = tx;
  }
  return best;
}

export function joinExposures(input: {
  liveDelegates: LiveDelegate[];
  history: HistoryTx[];
  grantedViaBySignature?: Record<string, string | null>;
  wallet?: string;
}): Exposure[] {
  const grantedViaBySignature = input.grantedViaBySignature ?? {};
  const liveAccounts = new Set(input.liveDelegates.map((d) => d.tokenAccount));
  const exposures: Exposure[] = [];

  for (const live of input.liveDelegates) {
    const grant = findGrant(input.history, live);
    const signature = grant?.signature ?? null;
    const via = signature ? (grantedViaBySignature[signature] ?? null) : null;
    const risk: Risk = live.delegatedAmount > 0n && live.balance > 0n ? "HIGH" : "MEDIUM";
    exposures.push({
      kind: "live_delegate",
      risk,
      mint: live.mint,
      tokenAccount: live.tokenAccount,
      delegate: live.delegate,
      amountAtRisk: live.delegatedAmount,
      grantedWhen: grant?.blockTime ?? null,
      grantedVia: via,
      signature,
      slot: grant?.slot ?? null,
      programId: live.programId,
      owner: live.owner,
    });
  }

  const seenOwnerChange = new Set<string>();
  const seenRevoked = new Set<string>();
  for (const tx of input.history) {
    const createdThisTx = initializedAccounts(tx);
    for (const ix of tx.instructions) {
      if (isSetAuthority(ix) && isOwnerAuthority(ix)) {
        const tokenAccount = tokenAccountOf(ix);
        if (tokenAccount && createdThisTx.has(tokenAccount)) continue;
        const currentAuthority = currentAuthorityOf(ix);
        if (input.wallet && currentAuthority && currentAuthority !== input.wallet) continue;
        const key = `${tx.signature}:${tokenAccount ?? ""}`;
        if (seenOwnerChange.has(key)) continue;
        seenOwnerChange.add(key);
        exposures.push({
          kind: "set_authority",
          risk: "HIGH",
          mint: mintOf(tx, ix, tokenAccount),
          tokenAccount,
          delegate: newAuthorityOf(ix),
          amountAtRisk: 0n,
          grantedWhen: tx.blockTime,
          grantedVia: tx.signature ? (grantedViaBySignature[tx.signature] ?? null) : null,
          signature: tx.signature,
          slot: tx.slot,
          programId: ix.programId,
          owner: currentAuthority,
        });
      }
      if (isApprove(ix)) {
        const source = tokenAccountOf(ix);
        if (source && !liveAccounts.has(source)) {
          const key = `${tx.signature}:${source}`;
          if (seenRevoked.has(key)) continue;
          seenRevoked.add(key);
          exposures.push({
            kind: "revoked_approve",
            risk: "INFO",
            mint: namedAccount(ix, "mint") ?? null,
            tokenAccount: source,
            delegate: delegateOf(ix),
            amountAtRisk: 0n,
            grantedWhen: tx.blockTime,
            grantedVia: null,
            signature: tx.signature,
            slot: tx.slot,
            programId: ix.programId,
            owner: namedAccount(ix, "owner") ?? null,
          });
        }
      }
    }
  }

  return exposures;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseDecodedAccounts(value: unknown): HistoryInstruction["decodedAccounts"] {
  if (!Array.isArray(value)) return [];
  const accounts: HistoryInstruction["decodedAccounts"] = [];
  for (const item of value) {
    if (typeof item === "string") {
      accounts.push({ name: null, pubkey: item });
      continue;
    }
    if (!isRecord(item)) continue;
    const name = readString(item.name);
    const pubkey = readString(item.pubkey) ?? readString(item.address) ?? readString(item.pubkeyString);
    accounts.push({ name, pubkey });
  }
  return accounts;
}

function parseRawAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const accounts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      accounts.push(item);
      continue;
    }
    if (isRecord(item)) {
      const pk = readString(item.pubkey) ?? readString(item.address);
      if (pk) accounts.push(pk);
    }
  }
  return accounts;
}

function parseInstruction(value: unknown): HistoryInstruction | null {
  if (!isRecord(value)) return null;
  const programId = readString(value.programId);
  if (!programId) return null;
  const instructionName = readString(value.instructionName) ?? readString(value.name);
  const decoded = isRecord(value.decoded) ? value.decoded : null;
  const decodedArgs = decoded && isRecord(decoded.args) ? decoded.args : isRecord(value.decodedArgs) ? value.decodedArgs : null;
  const decodedAccounts = parseDecodedAccounts(
    decoded?.accounts ?? value.decodedAccounts ?? value.accounts,
  );
  const rawAccounts = parseRawAccounts(value.rawAccounts);
  const rawData = readString(value.rawData) ?? readString(value.data);
  return { programId, instructionName, decodedArgs, decodedAccounts, rawAccounts, rawData };
}

export function parseHistoryTx(item: unknown): HistoryTx | null {
  if (!isRecord(item)) return null;
  const signature = readString(item.signature);
  if (!signature) return null;
  const inner = isRecord(item.parsed) ? item.parsed : item;
  const slot = readNumber(inner.slot) ?? readNumber(item.slot);
  const blockTime = readNumber(inner.blockTime) ?? readNumber(item.blockTime);
  const rawIxs = Array.isArray(inner.instructions)
    ? inner.instructions
    : Array.isArray(item.instructions)
      ? item.instructions
      : [];
  const instructions: HistoryInstruction[] = [];
  for (const raw of rawIxs) {
    const ix = parseInstruction(raw);
    if (ix) instructions.push(ix);
  }
  return { signature, slot, blockTime, instructions };
}

export function parseHistoryTxs(data: unknown[]): HistoryTx[] {
  const txs: HistoryTx[] = [];
  for (const item of data) {
    const tx = parseHistoryTx(item);
    if (tx) txs.push(tx);
  }
  return txs;
}

const SKIP_GRANTED_VIA = new Set<string>([
  ...TOKEN_PROGRAM_IDS,
  SYSTEM_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
]);

export function grantedViaFromTx(tx: HistoryTx): string | null {
  for (const ix of tx.instructions) {
    if (!SKIP_GRANTED_VIA.has(ix.programId)) return ix.programId;
  }
  return null;
}

export function tokenProgramMatches(): ProgramMatch[] {
  return TOKEN_PROGRAM_IDS.map((programId) => {
    const filter = TOKEN_PROGRAM_FILTERS[programId];
    if (filter?.mode === "discriminators") {
      return { programId, discriminators: filter.discriminators, scope: "address" as const };
    }
    return {
      programId,
      instructions: filter?.instructions ?? ["approve", "revoke", "set_authority", "approve_checked"],
      scope: "address" as const,
    };
  });
}

function liveDelegatesFromAccounts(
  accounts: Awaited<ReturnType<typeof getAllTokenAccounts>>,
): LiveDelegate[] {
  const delegates: LiveDelegate[] = [];
  for (const account of accounts) {
    if (!account.delegate) continue;
    delegates.push({
      tokenAccount: account.pubkey,
      mint: account.mint,
      owner: account.owner,
      programId: account.programId,
      delegate: account.delegate,
      delegatedAmount: account.delegatedAmount,
      balance: account.amount,
    });
  }
  return delegates;
}

function exposureSummary(exposures: Exposure[]): string {
  const live = exposures.filter((e) => e.kind === "live_delegate");
  const high = exposures.filter((e) => e.risk === "HIGH").length;
  return `${live.length} live delegates can move your tokens, ${high} high risk`;
}

function exposureTable(exposures: Exposure[]): string {
  const rows = exposures.map((e) => [
    e.mint ?? "",
    e.delegate ?? "",
    e.amountAtRisk.toString(),
    formatUnix(e.grantedWhen),
    e.grantedVia ?? "",
    e.signature ? `${ORB_TX_PREFIX}${e.signature}` : "",
    e.risk,
  ]);
  return markdownTable(
    ["token", "delegate", "amount at risk", "granted when", "granted via", "signature", "risk"],
    rows,
  );
}

export async function auditWalletExposure(
  client: HeliusClient,
  input: AuditWalletInput,
): Promise<string> {
  const wallet = input.wallet;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  const creditCap = input.creditCap ?? DEFAULT_CREDIT_CAP;

  const accounts = await getAllTokenAccounts(client, wallet);
  const liveDelegates = liveDelegatesFromAccounts(accounts);

  const historyScan = await scanHistory(client, {
    address: wallet,
    match: { programs: tokenProgramMatches() },
    status: "succeeded",
    sortOrder: "desc",
    tokenAccounts: "all",
    ...(input.sinceUnix !== undefined ? { time: { gte: input.sinceUnix } } : {}),
    maxPages,
    creditCap,
  });

  let creditsCharged = historyScan.scan.creditsCharged;
  let scannedTransactions = historyScan.scan.scannedTransactions;
  const history = parseHistoryTxs(historyScan.data);
  let exposures = joinExposures({ liveDelegates, history, wallet });

  const grantSlots = new Map<number, string[]>();
  for (const exp of exposures) {
    if (exp.kind !== "live_delegate" || exp.slot === null || !exp.signature) continue;
    const list = grantSlots.get(exp.slot) ?? [];
    list.push(exp.signature);
    grantSlots.set(exp.slot, list);
  }

  const grantedViaBySignature: Record<string, string | null> = {};
  for (const [slot, signatures] of grantSlots) {
    if (creditsCharged + PAGE_COST_ESTIMATE > creditCap) break;
    const extra = await scanHistory(client, {
      address: wallet,
      match: {
        programs: TOKEN_PROGRAM_IDS.map((programId) => ({
          programId,
          scope: "transaction" as const,
        })),
      },
      slot: { gte: slot, lte: slot },
      returnShape: "transactions",
      limit: 1,
      maxPages: 1,
      creditCap: creditCap - creditsCharged,
    });
    creditsCharged += extra.scan.creditsCharged;
    scannedTransactions += extra.scan.scannedTransactions;
    const txs = parseHistoryTxs(extra.data);
    for (const sig of signatures) {
      const match = txs.find((tx) => tx.signature === sig) ?? txs[0];
      grantedViaBySignature[sig] = match ? grantedViaFromTx(match) : null;
    }
  }

  if (Object.keys(grantedViaBySignature).length > 0) {
    exposures = joinExposures({ liveDelegates, history, grantedViaBySignature, wallet });
  }

  const targets: RevokeTarget[] = liveDelegates.map((d) => ({
    tokenAccount: d.tokenAccount,
    owner: d.owner,
    programId: d.programId,
  }));

  let transactionBase64 = "";
  if (targets.length > 0) {
    transactionBase64 = await createRevokeTxBase64(client, wallet, targets);
  }

  const fixPlan = {
    unsignedTransactionBase64: transactionBase64,
    note: "Sign this transaction in your own wallet. scan21 never signs or sends it.",
    revokes: liveDelegates.map((d) => ({
      mint: d.mint,
      tokenAccount: d.tokenAccount,
      delegate: d.delegate,
      programId: d.programId,
      instruction: {
        programId: d.programId,
        accounts: [
          { pubkey: d.tokenAccount, isSigner: false, isWritable: true },
          { pubkey: d.owner, isSigner: true, isWritable: false },
        ],
        dataBase64: Buffer.from([5]).toString("base64"),
      },
    })),
  };

  const parts = [
    exposureSummary(exposures),
    "",
    exposureTable(exposures),
    "",
    "Fix plan:",
    JSON.stringify(fixPlan, null, 2),
    "",
    formatCredits({ creditsCharged, scannedTransactions }),
  ];
  return parts.join("\n");
}
