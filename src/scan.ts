import { DEFAULT_MAX_SCANNED, PAGE_COST_ESTIMATE } from "./constants.js";
import type { HeliusClient } from "./helius.js";
import {
  ScanHistoryInputSchema,
  toHeliusPayload,
  type MergedScan,
  type ScanHistoryInput,
  type ScanHistoryInputRaw,
} from "./schemas.js";

export async function scanHistory(
  client: HeliusClient,
  input: ScanHistoryInput | ScanHistoryInputRaw,
): Promise<MergedScan> {
  const parsed = ScanHistoryInputSchema.parse(input);
  const maxPages = parsed.maxPages;
  const creditCap = parsed.creditCap;
  const body = toHeliusPayload(parsed);
  if (!body.budget?.maxScannedTransactions) {
    body.budget = { ...body.budget, maxScannedTransactions: DEFAULT_MAX_SCANNED };
  }

  const data: unknown[] = [];
  let pages = 0;
  let creditsCharged = 0;
  let scannedTransactions = 0;
  let matchedTransactions = 0;
  let stoppedOn: MergedScan["scan"]["stoppedOn"] = "windowEnd";
  let scannedThrough: MergedScan["scan"]["scannedThrough"];
  let paginationToken: string | undefined;
  let stoppedReason: MergedScan["stoppedReason"] = "complete";

  while (pages < maxPages) {
    if (creditsCharged + PAGE_COST_ESTIMATE > creditCap) {
      stoppedReason = "creditCap";
      break;
    }

    const pageBody = paginationToken ? { ...body, paginationToken } : body;
    const page = await client.scan(pageBody);
    pages += 1;
    data.push(...(page.data ?? []));
    creditsCharged += page.scan.creditsCharged;
    scannedTransactions += page.scan.scannedTransactions;
    matchedTransactions += page.scan.matchedTransactions;
    stoppedOn = page.scan.stoppedOn;
    if (page.scan.scannedThrough) scannedThrough = page.scan.scannedThrough;
    paginationToken = page.paginationToken;

    if (!paginationToken) {
      stoppedReason = "complete";
      break;
    }
    if (pages >= maxPages) {
      stoppedReason = "maxPages";
      break;
    }
  }

  const merged: MergedScan = {
    data,
    pages,
    scan: {
      stoppedOn,
      scannedTransactions,
      matchedTransactions,
      creditsCharged,
      ...(scannedThrough ? { scannedThrough } : {}),
    },
    stoppedReason,
  };
  if (paginationToken && stoppedReason !== "complete") {
    merged.paginationToken = paginationToken;
  }
  return merged;
}
