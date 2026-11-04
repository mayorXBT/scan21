import { z } from "zod";
import type { HeliusClient } from "./helius.js";
import { TOKEN_PROGRAM_IDS } from "./constants.js";

const TokenAmountSchema = z
  .object({
    amount: z.string(),
    decimals: z.number().optional(),
    uiAmount: z.number().nullable().optional(),
    uiAmountString: z.string().optional(),
  })
  .passthrough();

const ParsedInfoSchema = z
  .object({
    mint: z.string(),
    owner: z.string(),
    tokenAmount: TokenAmountSchema,
    delegate: z.string().nullable().optional(),
    delegatedAmount: TokenAmountSchema.optional(),
  })
  .passthrough();

const TokenAccountValueSchema = z
  .object({
    pubkey: z.string(),
    account: z
      .object({
        data: z
          .object({
            parsed: z
              .object({
                info: ParsedInfoSchema,
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const TokenAccountsResultSchema = z
  .object({
    value: z.array(TokenAccountValueSchema),
  })
  .passthrough();

export type LiveTokenAccount = {
  pubkey: string;
  mint: string;
  owner: string;
  programId: string;
  amount: bigint;
  uiAmount: number;
  delegate: string | null;
  delegatedAmount: bigint;
};

function parseAmount(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function parseUiAmount(amount: z.infer<typeof TokenAmountSchema>): number {
  if (typeof amount.uiAmount === "number") return amount.uiAmount;
  if (amount.uiAmountString) {
    const n = Number(amount.uiAmountString);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function getTokenAccountsByOwner(
  client: HeliusClient,
  owner: string,
  programId: string,
): Promise<LiveTokenAccount[]> {
  const raw = await client.rpc("getTokenAccountsByOwner", [
    owner,
    { programId },
    { encoding: "jsonParsed" },
  ]);
  const parsed = TokenAccountsResultSchema.parse(raw);
  const accounts: LiveTokenAccount[] = [];
  for (const item of parsed.value) {
    const info = item.account.data.parsed.info;
    const delegate = info.delegate ?? null;
    accounts.push({
      pubkey: item.pubkey,
      mint: info.mint,
      owner: info.owner,
      programId,
      amount: parseAmount(info.tokenAmount.amount),
      uiAmount: parseUiAmount(info.tokenAmount),
      delegate: delegate && delegate.length > 0 ? delegate : null,
      delegatedAmount: parseAmount(info.delegatedAmount?.amount),
    });
  }
  return accounts;
}

export async function getAllTokenAccounts(
  client: HeliusClient,
  owner: string,
): Promise<LiveTokenAccount[]> {
  const pages = await Promise.all(
    TOKEN_PROGRAM_IDS.map((programId) => getTokenAccountsByOwner(client, owner, programId)),
  );
  return pages.flat();
}

export function topHeldMints(accounts: LiveTokenAccount[], limit: number): string[] {
  const totals = new Map<string, number>();
  for (const account of accounts) {
    if (account.amount === 0n || account.uiAmount === 0) continue;
    totals.set(account.mint, (totals.get(account.mint) ?? 0) + account.uiAmount);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([mint]) => mint);
}
