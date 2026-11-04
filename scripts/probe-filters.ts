import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HELIUS_HOST,
  SCAN_PATH,
  TOKEN_DISCRIMINATORS,
  TOKEN_INSTRUCTION_NAMES,
  TOKEN_INSTRUCTION_NAMES_CAMEL,
  TOKEN_PROGRAM_IDS,
} from "../src/constants.js";

type FilterMode = "names" | "discriminators";
type Filter = {
  mode: FilterMode;
  instructions?: string[];
  discriminators?: string[];
};

function loadDotenv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(process.cwd(), ".env"), resolve(here, "../.env")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
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
    return;
  }
}

function writeFilters(filters: Record<string, Filter>): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, "../src/token-filters.ts");
  const body = `export const TOKEN_PROGRAM_FILTERS: Record<
  string,
  { mode: "names" | "discriminators"; instructions?: string[]; discriminators?: string[] }
> = ${JSON.stringify(filters, null, 2)};
`;
  writeFileSync(outPath, body);
  console.error(`wrote ${outPath}`);
}

function defaultFilters(): Record<string, Filter> {
  const filters: Record<string, Filter> = {};
  for (const programId of TOKEN_PROGRAM_IDS) {
    filters[programId] = { mode: "names", instructions: [...TOKEN_INSTRUCTION_NAMES] };
  }
  return filters;
}

async function probeProgram(apiKey: string, programId: string): Promise<Filter> {
  const url = `${HELIUS_HOST}${SCAN_PATH}?api-key=${apiKey}`;

  async function tryBody(matchProgram: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: string }> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: programId,
        match: { programs: [matchProgram] },
        returnShape: "count",
        budget: { maxScannedTransactions: 1 },
      }),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  }

  const snake = await tryBody({
    programId,
    instructions: [...TOKEN_INSTRUCTION_NAMES],
  });
  if (snake.ok) {
    console.error(`${programId} names ${TOKEN_INSTRUCTION_NAMES.join(",")}`);
    return { mode: "names", instructions: [...TOKEN_INSTRUCTION_NAMES] };
  }
  if (snake.status !== 400) {
    console.error(`${programId} names probe failed HTTP ${snake.status}`);
    return { mode: "names", instructions: [...TOKEN_INSTRUCTION_NAMES] };
  }

  const camel = await tryBody({
    programId,
    instructions: [...TOKEN_INSTRUCTION_NAMES_CAMEL],
  });
  if (camel.ok) {
    console.error(`${programId} names ${TOKEN_INSTRUCTION_NAMES_CAMEL.join(",")}`);
    return { mode: "names", instructions: [...TOKEN_INSTRUCTION_NAMES_CAMEL] };
  }
  if (camel.status !== 400) {
    console.error(`${programId} camelCase probe failed HTTP ${camel.status}`);
    return { mode: "names", instructions: [...TOKEN_INSTRUCTION_NAMES] };
  }

  const disc = await tryBody({
    programId,
    discriminators: [...TOKEN_DISCRIMINATORS],
  });
  if (disc.ok) {
    console.error(`${programId} discriminators ${TOKEN_DISCRIMINATORS.join(",")}`);
    return { mode: "discriminators", discriminators: [...TOKEN_DISCRIMINATORS] };
  }

  console.error(`${programId} probe failed, defaulting to names`);
  return { mode: "names", instructions: [...TOKEN_INSTRUCTION_NAMES] };
}

loadDotenv();
const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) {
  console.error("HELIUS_API_KEY is not set; writing default names filters");
  writeFilters(defaultFilters());
  process.exit(0);
}

const filters: Record<string, Filter> = {};
try {
  for (const programId of TOKEN_PROGRAM_IDS) {
    filters[programId] = await probeProgram(apiKey, programId);
  }
  writeFilters(filters);
} catch (err) {
  const msg = err instanceof Error ? err.message.replace(/api-key=[^&\s"']+/gi, "api-key=REDACTED") : "probe failed";
  console.error(msg);
  writeFilters(defaultFilters());
  process.exit(1);
}
