# scan21

MCP server that audits a Solana wallet for dangling token delegations and token-account owner changes. One tool call. Powered by Helius [Parsed Events Scan](https://www.helius.dev/docs/api-reference/parsed-events/scan.md) (`POST /v1/parsed-events/scan`, launched 3 Nov 2026).

Name is a nod to 2021, the year this exact indexing pain pushed Helius's founders to start the company.

Read-only. No private keys. Never signs or sends.

## Why this exists

Two common drain paths on Solana:

1. An SPL `Approve` / `ApproveChecked` leaves a delegate who can still move tokens.
2. A `SetAuthority` instruction hands the token account's owner to someone else.

Finding those used to mean pulling a wallet's full history and parsing it yourself. Scan turns that into one filtered request, about 20 credits at the default budget.

Helius's official MCP (`helius-mcp`, 10 tools) already wraps Scan as `heliusTransaction.scanTransactionHistory`. It does not join live token-account state with that history, score risk, or hand back an unsigned revoke transaction. scan21 does.

Proposal: [helius-labs/core-ai#229](https://github.com/helius-labs/core-ai/issues/229) (`auditWalletExposure` on `heliusTransaction`).

## Install

Needs Node 20+ and a [Helius API key](https://www.helius.dev/).

```bash
git clone https://github.com/mayorXBT/scan21.git
cd scan21
npm install
npm run build
```

Copy `.env.example` to `.env` and set `HELIUS_API_KEY`. The process never logs the key.

**Claude Code**

```bash
claude mcp add scan21 --env HELIUS_API_KEY=YOUR_KEY -- node /absolute/path/to/scan21/dist/index.js
```

Or, after the repo is public:

```bash
claude mcp add scan21 --env HELIUS_API_KEY=YOUR_KEY -- npx -y github:mayorXBT/scan21
```

**Claude Desktop / Cursor** (`mcp.json`):

```json
{
  "mcpServers": {
    "scan21": {
      "command": "node",
      "args": ["/absolute/path/to/scan21/dist/index.js"],
      "env": { "HELIUS_API_KEY": "YOUR_KEY" }
    }
  }
}
```

Stdio transport. Ask the agent:

```
audit this wallet for anything that can drain it: <WALLET>
```

## Tools

### `scan_history`

Typed wrapper around Scan. Every documented body field, plus `maxPages` (default 5) and `creditCap` (default 100). Zod `.strict()` drops unknown fields before the HTTP call so Helius does not 400 on `{"error":"invalid request payload"}`.

Paginates while `paginationToken` is present, including empty `data` pages (a budget stop with zero matches is normal). Stops at `windowEnd`, `maxPages`, or `creditCap`. Merges `data` and sums `creditsCharged` / `scannedTransactions`. All three `returnShape`s: `transactions`, `signatures`, `count`.

Retries 503 and network errors with exponential backoff, max 3. Surfaces 400 bodies verbatim.

### `audit_wallet_exposure`

Headline tool.

**Input:** `wallet`, optional `sinceUnix`, optional `creditCap` (default 100).

**Live state.** `getTokenAccountsByOwner` (jsonParsed) on SPL Token and Token-2022. Every account with a non-null delegate is an exposure: mint, balance, delegated amount.

**History.** `scan_history` on both token programs, filtered to approve / approve_checked / revoke / set_authority, `status: "succeeded"`, `sortOrder: "desc"`.

**Join.** For each live delegate, the most recent matching approve (signature, time). A second Scan with `scope: "transaction"` on that slot names the other program in the tx (the dApp that asked for the approval).

**Flags**

| Risk | When |
| --- | --- |
| HIGH | Live delegate, delegated amount > 0, token account balance > 0 |
| HIGH | `set_authority` that changed the owner of a token account this wallet already owned. Skips mint-time owner handoffs (`initialize_account*` then `set_authority` in the same tx) |
| MEDIUM | Live delegate on a zero-balance account (dormant but armed) |
| INFO | Approvals whose token account no longer has a live delegate |

**Output.** A one-line summary (`2 live delegates can move your tokens, 1 high risk`), then a table: token, delegate, amount at risk, granted when, granted via, [orb.helius.dev](https://orb.helius.dev) signature link, risk.

**Fix plan.** For each live delegate, the exact revoke instruction (program, accounts, data byte `5`) and one unsigned transaction as base64. Sign it in your own wallet. scan21 never signs or sends.

Always includes `creditsCharged` and `scannedTransactions`.

### `trace_outflows`

Incident response. Input: `wallet`, `sinceUnix`, optional `mints[]`. Scans native SOL plus those mints (or the wallet's top 10 held mints). Keeps outflows from the wallet. Groups by recipient: total per token, first/last time, tx count, signatures.

## Instruction filters (names vs discriminators)

Probed live against mainnet Scan on 4 Nov 2026.

IDL / snake_case names `approve`, `revoke`, `set_authority`, `approve_checked` return **400** (unknown instruction) for both token programs.

**Discriminators work** for both:

| Instruction | Name tried | Discriminator |
| --- | --- | --- |
| Approve | `approve` | `04` |
| Revoke | `revoke` | `05` |
| SetAuthority | `set_authority` | `06` |
| ApproveChecked | `approve_checked` | `0d` |

Programs:

- SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`

Classification of returned instructions uses the parsed `instructionName` when Helius sets it, otherwise the first data byte (`4`, `5`, `6`, `13`). Only token-program instructions are classified. Non-token programs whose data starts with `0x06` are ignored.

Re-run the probe with `npm run probe-filters`. It rewrites `src/token-filters.ts`.

## Example output

```
2 live delegates can move your tokens, 1 high risk

| token | delegate | amount at risk | granted when | granted via | signature | risk |
| --- | --- | --- | --- | --- | --- | --- |
| EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v | ComputeBudget111111111111111111111111111111 | 50 | 2026-03-01T00:03:20.000Z | JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 | https://orb.helius.dev/tx/grant-high | HIGH |
| EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v | ComputeBudget111111111111111111111111111111 | 50 | 2026-03-01T00:02:30.000Z |  | https://orb.helius.dev/tx/grant-dormant | MEDIUM |

Fix plan:
{
  "unsignedTransactionBase64": "<base64, unsigned>",
  "note": "Sign this transaction in your own wallet. scan21 never signs or sends it.",
  "revokes": [
    {
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "tokenAccount": "<account>",
      "delegate": "<delegate>",
      "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "instruction": {
        "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "accounts": [
          { "pubkey": "<account>", "isSigner": false, "isWritable": true },
          { "pubkey": "<owner>", "isSigner": true, "isWritable": false }
        ],
        "dataBase64": "BQ=="
      }
    }
  ]
}

creditsCharged: 20
scannedTransactions: 10000
```

`BQ==` is instruction data byte `5` (Revoke). The unsigned tx is a legacy Solana transaction, serialized with `requireAllSignatures: false`.

## Credit costs

Scan bills **10 credits per request + 1 per history page scanned** (pages of up to 1,000 txs). Default budget 10,000 txs, so about 20 credits per page.

scan21 defaults:

- `maxPages` 5
- `creditCap` 100
- `budget.maxScannedTransactions` 10,000

Both are overridable per call. The pager stops before the next request if `creditsCharged + 11` would exceed the cap.

Live check on a busy public wallet (`GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52`), `creditCap: 20`:

- count shape, 2,000 txs scanned: 12 credits, 2 matches
- full audit: stopped at the cap, **20 credits**, 10,000 txs scanned, 0 live delegates, 0 high risk

## Tests

```bash
npm test
npm run typecheck
```

Unit coverage: unknown Scan fields rejected, limit bounds, pagination across an empty budget-stop page, credit cap, join HIGH/MEDIUM/INFO, mint-flow `set_authority` skipped, revoke instruction layout (data byte 5, source then owner).

Live approve-then-revoke of a throwaway token is not in this repo. scan21 does not hold keys. Join and revoke encoding are covered by fixtures. Re-run a live audit with:

```bash
npx tsx scripts/live-audit.ts <WALLET> <creditCap>
```

## Helius MCP

[helius-labs/core-ai](https://github.com/helius-labs/core-ai) already exposes Scan as `scanTransactionHistory`. The gap is the exposure join, risk table, and unsigned revoke. Proposed as [`auditWalletExposure`](https://github.com/helius-labs/core-ai/issues/229).

## Out of scope

Signing or sending transactions, custody of keys, UI, non-Solana chains.

## License

MIT. Copyright 2026 mayorXBT.
