import bs58 from "bs58";

const HEX = /^[0-9a-f]+$/i;

export function instructionDataBytes(rawData: string | null | undefined): Uint8Array | null {
  if (!rawData) return null;
  try {
    const decoded = bs58.decode(rawData);
    if (decoded.length > 0) return decoded;
  } catch {
    // fall through to hex
  }
  const trimmed = rawData.startsWith("0x") || rawData.startsWith("0X") ? rawData.slice(2) : rawData;
  if (HEX.test(trimmed) && trimmed.length % 2 === 0 && trimmed.length >= 2) {
    try {
      return Uint8Array.from(Buffer.from(trimmed, "hex"));
    } catch {
      return null;
    }
  }
  return null;
}

export function tokenInstructionIndex(rawData: string | null | undefined): number | null {
  const bytes = instructionDataBytes(rawData);
  if (!bytes || bytes.length === 0) return null;
  return bytes[0] ?? null;
}

export function setAuthorityType(rawData: string | null | undefined): number | null {
  const bytes = instructionDataBytes(rawData);
  if (!bytes || bytes[0] !== 6 || bytes.length < 2) return null;
  return bytes[1] ?? null;
}

export function newAuthorityFromData(rawData: string | null | undefined): string | null {
  const bytes = instructionDataBytes(rawData);
  if (!bytes || bytes[0] !== 6) return null;
  if (bytes.length >= 35 && bytes[2] === 1) {
    return bs58.encode(bytes.slice(3, 35));
  }
  if (bytes.length >= 3 && bytes[2] === 0) return null;
  if (
    bytes.length >= 38 &&
    bytes[2] === 1 &&
    bytes[3] === 0 &&
    bytes[4] === 0 &&
    bytes[5] === 0
  ) {
    return bs58.encode(bytes.slice(6, 38));
  }
  return null;
}

export const IX_APPROVE = 4;
export const IX_REVOKE = 5;
export const IX_SET_AUTHORITY = 6;
export const IX_APPROVE_CHECKED = 13;
export const IX_INITIALIZE_ACCOUNT = 1;
export const IX_INITIALIZE_ACCOUNT2 = 16;
export const IX_INITIALIZE_ACCOUNT3 = 18;
export const AUTH_ACCOUNT_OWNER = 2;
