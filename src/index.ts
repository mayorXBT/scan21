#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createScan21Server } from "./server.js";

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

loadDotenv();

const apiKey = process.env.HELIUS_API_KEY;
if (!apiKey) {
  console.error("HELIUS_API_KEY is not set");
  process.exit(1);
}

const server = createScan21Server({ apiKey });
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("scan21 listening on stdio");
