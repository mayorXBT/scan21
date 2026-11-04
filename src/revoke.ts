import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { z } from "zod";
import type { HeliusClient } from "./helius.js";

export type RevokeTarget = {
  tokenAccount: string;
  owner: string;
  programId: string;
};

const BlockhashResultSchema = z
  .object({
    value: z.object({
      blockhash: z.string(),
      lastValidBlockHeight: z.number().optional(),
    }),
  })
  .passthrough();

export async function getLatestBlockhash(client: HeliusClient): Promise<string> {
  const raw = await client.rpc("getLatestBlockhash", []);
  const parsed = BlockhashResultSchema.parse(raw);
  return parsed.value.blockhash;
}

export function buildRevokeTransaction(opts: {
  feePayer: string;
  recentBlockhash: string;
  targets: RevokeTarget[];
}): string {
  const feePayer = new PublicKey(opts.feePayer);
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = opts.recentBlockhash;
  for (const target of opts.targets) {
    tx.add(
      new TransactionInstruction({
        programId: new PublicKey(target.programId),
        keys: [
          { pubkey: new PublicKey(target.tokenAccount), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(target.owner), isSigner: true, isWritable: false },
        ],
        data: Buffer.from([5]),
      }),
    );
  }
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(serialized).toString("base64");
}

export async function createRevokeTxBase64(
  client: HeliusClient,
  feePayer: string,
  targets: RevokeTarget[],
): Promise<string> {
  const recentBlockhash = await getLatestBlockhash(client);
  return buildRevokeTransaction({ feePayer, recentBlockhash, targets });
}
