import { describe, expect, it } from "vitest";
import { ScanBodySchema, ScanHistoryInputSchema, toHeliusPayload } from "../src/schemas.js";

const validBody = {
  address: "GV6UUmNxz2RpKxmNAPadYKb7uQpszwqQAu3qLJxVdC52",
  match: {
    programs: [{ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }],
  },
};

describe("ScanBodySchema", () => {
  it("rejects an unknown field", () => {
    expect(() => ScanBodySchema.parse({ ...validBody, extra: true })).toThrow();
  });

  it("rejects limit 0", () => {
    expect(() => ScanBodySchema.parse({ ...validBody, limit: 0 })).toThrow();
  });

  it("rejects limit 101", () => {
    expect(() => ScanBodySchema.parse({ ...validBody, limit: 101 })).toThrow();
  });

  it("rejects a missing match", () => {
    expect(() => ScanBodySchema.parse({ address: validBody.address })).toThrow();
  });

  it("parses a valid body", () => {
    const parsed = ScanBodySchema.parse(validBody);
    expect(parsed.address).toBe(validBody.address);
    expect(parsed.match.programs?.[0]?.programId).toBe(validBody.match.programs[0]?.programId);
  });
});

describe("toHeliusPayload", () => {
  it("strips maxPages and creditCap from the helius payload", () => {
    const parsed = ScanHistoryInputSchema.parse({
      ...validBody,
      maxPages: 3,
      creditCap: 50,
    });
    expect(parsed.maxPages).toBe(3);
    expect(parsed.creditCap).toBe(50);
    const payload = toHeliusPayload(parsed);
    expect(payload).not.toHaveProperty("maxPages");
    expect(payload).not.toHaveProperty("creditCap");
    expect(payload.address).toBe(validBody.address);
  });
});
