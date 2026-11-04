export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111111";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

export const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const;

export const HELIUS_HOST = "https://mainnet.helius-rpc.com";
export const SCAN_PATH = "/v1/parsed-events/scan";

export const CREDIT_BASE = 10;
export const CREDIT_PER_PAGE = 1;
export const PAGE_COST_ESTIMATE = CREDIT_BASE + CREDIT_PER_PAGE;

export const DEFAULT_MAX_PAGES = 5;
export const DEFAULT_CREDIT_CAP = 100;
export const DEFAULT_MAX_SCANNED = 10000;

export const TOKEN_INSTRUCTION_NAMES = [
  "approve",
  "revoke",
  "set_authority",
  "approve_checked",
] as const;

export const TOKEN_INSTRUCTION_NAMES_CAMEL = [
  "approve",
  "revoke",
  "setAuthority",
  "approveChecked",
] as const;

export const TOKEN_DISCRIMINATORS = ["04", "05", "06", "0d"] as const;

export const ORB_TX_PREFIX = "https://orb.helius.dev/tx/";

export const APPROVE_NAMES = new Set(["approve", "approve_checked", "approvechecked"]);
export const SET_AUTHORITY_NAMES = new Set(["set_authority", "setauthority"]);
