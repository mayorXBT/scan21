import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHeliusClient } from "../src/helius.js";
import { parseHistoryTxs } from "../src/audit.js";
import { TOKEN_PROGRAM_IDS } from "../src/constants.js";
import { tokenInstructionIndex, setAuthorityType } from "../src/token-ix.js";

function loadDotenv(): void {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotenv();
const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) process.exit(1);
const client = createHeliusClient({ apiKey });
const wallet = "GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52";
const page = await client.scan({
  address: wallet,
  match: {
    programs: TOKEN_PROGRAM_IDS.map((programId) => ({
      programId,
      discriminators: ["04", "05", "06", "0d"],
    })),
  },
  status: "succeeded",
  sortOrder: "desc",
  tokenAccounts: "all",
  limit: 2,
  budget: { maxScannedTransactions: 2000 },
});
const txs = parseHistoryTxs(page.data ?? []);
for (const tx of txs) {
  console.error("sig", tx.signature, "ix", tx.instructions.length);
  for (const ix of tx.instructions) {
    if (!TOKEN_PROGRAM_IDS.includes(ix.programId as (typeof TOKEN_PROGRAM_IDS)[number])) continue;
    console.error(
      JSON.stringify({
        programId: ix.programId.slice(0, 8),
        name: ix.instructionName,
        idx: tokenInstructionIndex(ix.rawData),
        auth: setAuthorityType(ix.rawData),
        raw0: ix.rawAccounts[0]?.slice(0, 8),
        rawLen: ix.rawData?.length ?? 0,
      }),
    );
  }
}
console.error("credits", page.scan.creditsCharged);
