# AGENTS.md

scan21 is an MCP server. Read-only. `HELIUS_API_KEY` is the only secret. Never log it. Never add signing or sending.

## Commands

- `npm test` — vitest, no network
- `npm run typecheck`
- `npm run build` — `tsc` into `dist/`
- `npm start` — stdio MCP (`dist/index.js`)
- `npx tsx scripts/probe-filters.ts` — live probe of Scan instruction names vs discriminators, rewrites `src/token-filters.ts`
- `npx tsx scripts/live-audit.ts <wallet> <creditCap>` — live `audit_wallet_exposure`

## Layout

- `src/helius.ts` — Scan + JSON-RPC, retries, key redaction
- `src/scan.ts` — pagination and credit cap
- `src/audit.ts` — live delegates joined to history
- `src/trace.ts` — outflow grouping
- `src/revoke.ts` — unsigned revoke tx, never signed
- `src/server.ts` — three MCP tools, stdio in `src/index.ts`

Helius rejects token-program instruction **names** and accepts discriminators `04 05 06 0d`. See README.
