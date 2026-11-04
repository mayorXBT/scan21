import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError } from "zod";
import { auditWalletExposure } from "./audit.js";
import { createHeliusClient, HeliusError, redactSecret, type FetchFn } from "./helius.js";
import { scanHistory } from "./scan.js";
import {
  AuditWalletInputSchema,
  ScanHistoryInputSchema,
  TraceOutflowsInputSchema,
} from "./schemas.js";
import { traceOutflows } from "./trace.js";

export type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function toolError(err: unknown): TextResult {
  if (err instanceof ZodError) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
  if (err instanceof HeliusError && err.status === 400) {
    return { isError: true, content: [{ type: "text", text: err.body }] };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: redactSecret(msg) }] };
}

export function createScan21Server(opts: { apiKey: string; fetchFn?: FetchFn }): McpServer {
  const client = createHeliusClient({ apiKey: opts.apiKey, fetchFn: opts.fetchFn });
  const server = new McpServer({ name: "scan21", version: "1.0.0" });

  server.registerTool(
    "scan_history",
    {
      description:
        "Scan an address history with Helius Parsed Events Scan. Merges pages until windowEnd, maxPages, or creditCap.",
      inputSchema: ScanHistoryInputSchema,
    },
    async (args) => {
      try {
        const input = ScanHistoryInputSchema.parse(args);
        const merged = await scanHistory(client, input);
        return { content: [{ type: "text", text: JSON.stringify(merged) }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "audit_wallet_exposure",
    {
      description:
        "Join live SPL token delegates with approve/revoke/set_authority history and return a revoke transaction to sign.",
      inputSchema: AuditWalletInputSchema,
    },
    async (args) => {
      try {
        const input = AuditWalletInputSchema.parse(args);
        const text = await auditWalletExposure(client, input);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "trace_outflows",
    {
      description:
        "Group native SOL and token outflows from a wallet since a unix timestamp, by recipient and mint.",
      inputSchema: TraceOutflowsInputSchema,
    },
    async (args) => {
      try {
        const input = TraceOutflowsInputSchema.parse(args);
        const text = await traceOutflows(client, input);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  return server;
}
