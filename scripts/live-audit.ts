import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditWalletExposure } from "../src/audit.js";
import { createHeliusClient } from "../src/helius.js";
import { scanHistory } from "../src/scan.js";
import { tokenProgramMatches } from "../src/audit.js";

function loadDotenv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "../.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotenv();
const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) {
  console.error("HELIUS_API_KEY is not set");
  process.exit(1);
}

const wallet = process.argv[2] ?? "GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52";
const creditCap = Number(process.argv[3] ?? "40");
const client = createHeliusClient({ apiKey });

const count = await scanHistory(client, {
  address: wallet,
  match: { programs: tokenProgramMatches() },
  returnShape: "count",
  status: "succeeded",
  tokenAccounts: "all",
  maxPages: 1,
  creditCap,
  budget: { maxScannedTransactions: 2000 },
});
console.error(
  JSON.stringify({
    wallet,
    countStoppedOn: count.scan.stoppedOn,
    creditsCharged: count.scan.creditsCharged,
    scannedTransactions: count.scan.scannedTransactions,
    matchedTransactions: count.scan.matchedTransactions,
  }),
);

const text = await auditWalletExposure(client, {
  wallet,
  creditCap,
  maxPages: 2,
});
const lines = text.split("\n");
console.error(lines.slice(0, 12).join("\n"));
const creditLine = lines.find((l) => l.startsWith("creditsCharged"));
const scannedLine = lines.find((l) => l.startsWith("scannedTransactions"));
console.error(creditLine ?? "");
console.error(scannedLine ?? "");
