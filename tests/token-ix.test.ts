import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import {
  AUTH_ACCOUNT_OWNER,
  IX_SET_AUTHORITY,
  newAuthorityFromData,
  setAuthorityType,
  tokenInstructionIndex,
} from "../src/token-ix.js";

describe("token instruction data", () => {
  it("reads set_authority type and new authority from packed bytes", () => {
    const newOwner = Buffer.alloc(32, 9);
    const packed = Buffer.concat([Buffer.from([IX_SET_AUTHORITY, AUTH_ACCOUNT_OWNER, 1]), newOwner]);
    const hex = packed.toString("hex");
    const b58 = bs58.encode(packed);
    expect(tokenInstructionIndex(hex)).toBe(IX_SET_AUTHORITY);
    expect(setAuthorityType(hex)).toBe(AUTH_ACCOUNT_OWNER);
    expect(newAuthorityFromData(hex)).toBe(bs58.encode(newOwner));
    expect(newAuthorityFromData(b58)).toBe(bs58.encode(newOwner));
  });

  it("returns null when new authority is None", () => {
    const packed = Buffer.from([6, 2, 0]);
    expect(newAuthorityFromData(packed.toString("hex"))).toBeNull();
  });
});
