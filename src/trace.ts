import {
  DEFAULT_CREDIT_CAP,
  DEFAULT_MAX_PAGES,
  NATIVE_SOL_MINT,
  ORB_TX_PREFIX,
} from "./constants.js";
import { formatCredits, formatUnix, markdownTable } from "./format.js";
import type { HeliusClient } from "./helius.js";
import { scanHistory } from "./scan.js";
import { isRecord, type TraceOutflowsInput } from "./schemas.js";
import { getAllTokenAccounts, topHeldMints } from "./token-accounts.js";

export type Outflow = {
  recipient: string;
  mint: string;
  amount: bigint;
  signature: string;
  blockTime: number | null;
};

export type GroupedOutflow = {
  recipient: string;
  mint: string;
  total: bigint;
  firstBlockTime: number | null;
  lastBlockTime: number | null;
  txCount: number;
  signatures: string[];
};

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readAmount(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.length > 0) {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function txMeta(item: unknown): { signature: string; blockTime: number | null; body: Record<string, unknown> } | null {
  if (!isRecord(item)) return null;
  const signature = readString(item.signature);
  if (!signature) return null;
  const body = isRecord(item.parsed) ? item.parsed : item;
  const blockTime = readNumber(body.blockTime) ?? readNumber(item.blockTime);
  return { signature, blockTime, body };
}

export function collectOutflows(wallet: string, txs: unknown[]): Outflow[] {
  const outflows: Outflow[] = [];
  for (const item of txs) {
    const meta = txMeta(item);
    if (!meta) continue;
    const native = Array.isArray(meta.body.nativeTransfers) ? meta.body.nativeTransfers : [];
    for (const transfer of native) {
      if (!isRecord(transfer)) continue;
      if (readString(transfer.fromUserAccount) !== wallet) continue;
      const recipient = readString(transfer.toUserAccount);
      if (!recipient) continue;
      outflows.push({
        recipient,
        mint: NATIVE_SOL_MINT,
        amount: readAmount(transfer.amount),
        signature: meta.signature,
        blockTime: meta.blockTime,
      });
    }
    const tokens = Array.isArray(meta.body.tokenTransfers) ? meta.body.tokenTransfers : [];
    for (const transfer of tokens) {
      if (!isRecord(transfer)) continue;
      if (readString(transfer.fromUserAccount) !== wallet) continue;
      const recipient = readString(transfer.toUserAccount);
      const mint = readString(transfer.mint);
      if (!recipient || !mint) continue;
      const amount = readAmount(transfer.rawTokenAmount ?? transfer.tokenAmount ?? transfer.amount);
      outflows.push({
        recipient,
        mint,
        amount,
        signature: meta.signature,
        blockTime: meta.blockTime,
      });
    }
  }
  return outflows;
}

function cmpTotalDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

export function groupOutflows(outflows: Outflow[]): GroupedOutflow[] {
  const groups = new Map<string, GroupedOutflow>();
  for (const outflow of outflows) {
    const key = `${outflow.recipient}\0${outflow.mint}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        recipient: outflow.recipient,
        mint: outflow.mint,
        total: outflow.amount,
        firstBlockTime: outflow.blockTime,
        lastBlockTime: outflow.blockTime,
        txCount: 1,
        signatures: [outflow.signature],
      });
      continue;
    }
    existing.total += outflow.amount;
    if (outflow.blockTime !== null) {
      if (existing.firstBlockTime === null || outflow.blockTime < existing.firstBlockTime) {
        existing.firstBlockTime = outflow.blockTime;
      }
      if (existing.lastBlockTime === null || outflow.blockTime > existing.lastBlockTime) {
        existing.lastBlockTime = outflow.blockTime;
      }
    }
    if (!existing.signatures.includes(outflow.signature)) {
      existing.signatures.push(outflow.signature);
      existing.txCount = existing.signatures.length;
    }
  }

  const all = [...groups.values()];
  const sol = all.filter((g) => g.mint === NATIVE_SOL_MINT).sort((a, b) => cmpTotalDesc(a.total, b.total));
  const tokens = all.filter((g) => g.mint !== NATIVE_SOL_MINT).sort((a, b) => cmpTotalDesc(a.total, b.total));
  return [...sol, ...tokens];
}

function outflowTable(groups: GroupedOutflow[]): string {
  const rows = groups.map((g) => [
    g.recipient,
    g.mint,
    g.total.toString(),
    formatUnix(g.firstBlockTime),
    formatUnix(g.lastBlockTime),
    String(g.txCount),
  ]);
  return markdownTable(["recipient", "mint", "total", "first", "last", "txs"], rows);
}

export async function traceOutflows(client: HeliusClient, input: TraceOutflowsInput): Promise<string> {
  const wallet = input.wallet;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  const creditCap = input.creditCap ?? DEFAULT_CREDIT_CAP;

  let mints: string[];
  if (input.mints && input.mints.length > 0) {
    mints = input.mints;
  } else {
    const accounts = await getAllTokenAccounts(client, wallet);
    mints = topHeldMints(accounts, 10);
  }

  const unique: string[] = [];
  unique.push(NATIVE_SOL_MINT);
  for (const mint of mints) {
    if (mint === NATIVE_SOL_MINT) continue;
    if (!unique.includes(mint)) unique.push(mint);
    if (unique.length >= 20) break;
  }

  const merged = await scanHistory(client, {
    address: wallet,
    match: { mints: unique.map((mint) => ({ mint })) },
    time: { gte: input.sinceUnix },
    sortOrder: "asc",
    tokenAccounts: "balanceChanged",
    maxPages,
    creditCap,
  });

  const groups = groupOutflows(collectOutflows(wallet, merged.data));
  const signatures = [...new Set(groups.flatMap((g) => g.signatures))];
  const sigList = signatures.map((sig) => `- ${ORB_TX_PREFIX}${sig}`).join("\n");

  return [
    "Where did the funds go",
    "",
    outflowTable(groups),
    "",
    "Signatures:",
    sigList.length > 0 ? sigList : "(none)",
    "",
    formatCredits({
      creditsCharged: merged.scan.creditsCharged,
      scannedTransactions: merged.scan.scannedTransactions,
    }),
  ].join("\n");
}
