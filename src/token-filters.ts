export const TOKEN_PROGRAM_FILTERS: Record<
  string,
  { mode: "names" | "discriminators"; instructions?: string[]; discriminators?: string[] }
> = {
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": {
    "mode": "discriminators",
    "discriminators": [
      "04",
      "05",
      "06",
      "0d"
    ]
  },
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": {
    "mode": "discriminators",
    "discriminators": [
      "04",
      "05",
      "06",
      "0d"
    ]
  }
};
