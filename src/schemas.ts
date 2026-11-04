import { z } from "zod";
import { DEFAULT_CREDIT_CAP, DEFAULT_MAX_PAGES } from "./constants.js";

export const ScopeSchema = z.enum(["address", "transaction"]);
export type Scope = z.infer<typeof ScopeSchema>;

export const ProgramMatchSchema = z
  .object({
    programId: z.string(),
    instructions: z.array(z.string()).optional(),
    discriminators: z.array(z.string()).optional(),
    scope: ScopeSchema.optional(),
  })
  .strict();
export type ProgramMatch = z.infer<typeof ProgramMatchSchema>;

export const MintMatchSchema = z
  .object({
    mint: z.string(),
    scope: ScopeSchema.optional(),
  })
  .strict();
export type MintMatch = z.infer<typeof MintMatchSchema>;

export const RangeSchema = z
  .object({
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
  })
  .strict();
export type Range = z.infer<typeof RangeSchema>;

export const MatchSchema = z
  .object({
    programs: z.array(ProgramMatchSchema).optional(),
    mints: z.array(MintMatchSchema).optional(),
  })
  .strict()
  .refine((match) => (match.programs?.length ?? 0) > 0 || (match.mints?.length ?? 0) > 0, {
    message: "match must include programs or mints",
  });

export const ScanBodySchema = z
  .object({
    address: z.string(),
    match: MatchSchema,
    returnShape: z.enum(["transactions", "signatures", "count"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    budget: z
      .object({
        maxScannedTransactions: z.number().int().min(1).max(10000).optional(),
      })
      .strict()
      .optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    status: z.enum(["succeeded", "failed", "any"]).optional(),
    tokenAccounts: z.enum(["none", "balanceChanged", "all"]).optional(),
    slot: RangeSchema.optional(),
    time: RangeSchema.optional(),
    beforeSignature: z.string().optional(),
    afterSignature: z.string().optional(),
    paginationToken: z.string().optional(),
    commitment: z.enum(["confirmed", "finalized"]).optional(),
    rawTransaction: z.enum(["none", "json", "jsonParsed", "base64"]).optional(),
    minContextSlot: z.number().optional(),
  })
  .strict();
export type ScanBody = z.infer<typeof ScanBodySchema>;

export const ScanHistoryInputSchema = ScanBodySchema.extend({
  maxPages: z.number().int().positive().optional().default(DEFAULT_MAX_PAGES),
  creditCap: z.number().int().positive().optional().default(DEFAULT_CREDIT_CAP),
}).strict();
export type ScanHistoryInput = z.infer<typeof ScanHistoryInputSchema>;
export type ScanHistoryInputRaw = z.input<typeof ScanHistoryInputSchema>;

export const ScanPageSchema = z.object({
  data: z.array(z.unknown()).optional(),
  paginationToken: z.string().optional(),
  scan: z.object({
    stoppedOn: z.enum(["windowEnd", "limit", "budget", "deadline"]),
    scannedTransactions: z.number(),
    matchedTransactions: z.number(),
    scannedThrough: z
      .object({
        slot: z.number(),
        blockTime: z.number().nullable(),
      })
      .optional(),
    creditsCharged: z.number(),
  }),
});
export type ScanPage = z.infer<typeof ScanPageSchema>;

export type MergedScan = {
  data: unknown[];
  pages: number;
  paginationToken?: string;
  scan: ScanPage["scan"];
  stoppedReason: "complete" | "maxPages" | "creditCap";
};

export const AuditWalletInputSchema = z
  .object({
    wallet: z.string(),
    sinceUnix: z.number().optional(),
    creditCap: z.number().int().positive().optional().default(DEFAULT_CREDIT_CAP),
    maxPages: z.number().int().positive().optional().default(DEFAULT_MAX_PAGES),
  })
  .strict();
export type AuditWalletInput = z.infer<typeof AuditWalletInputSchema>;

export const TraceOutflowsInputSchema = z
  .object({
    wallet: z.string(),
    sinceUnix: z.number(),
    mints: z.array(z.string()).optional(),
    creditCap: z.number().int().positive().optional().default(DEFAULT_CREDIT_CAP),
    maxPages: z.number().int().positive().optional().default(DEFAULT_MAX_PAGES),
  })
  .strict();
export type TraceOutflowsInput = z.infer<typeof TraceOutflowsInputSchema>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toHeliusPayload(input: ScanHistoryInput | ScanHistoryInputRaw): ScanBody {
  const parsed = ScanHistoryInputSchema.parse(input);
  const { maxPages: _maxPages, creditCap: _creditCap, ...body } = parsed;
  return ScanBodySchema.parse(body);
}
