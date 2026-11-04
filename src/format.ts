export function markdownTable(headers: string[], rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const esc = (cell: string) => cell.replace(/\|/g, "\\|");
  const line = (cols: readonly string[]) => `| ${cols.map(esc).join(" | ")} |`;
  const header = line(headers);
  const sep = line(headers.map(() => "---"));
  return [header, sep, ...rows.map((row) => line(row))].join("\n");
}

export function formatUnix(unix: number | null | undefined): string {
  if (unix === null || unix === undefined) return "";
  return new Date(unix * 1000).toISOString();
}

export function formatCredits(opts: { creditsCharged: number; scannedTransactions: number }): string {
  return `creditsCharged: ${opts.creditsCharged}\nscannedTransactions: ${opts.scannedTransactions}`;
}
