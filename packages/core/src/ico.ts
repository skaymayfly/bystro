const ICO_FORMAT = /^\d{8}$/;
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2] as const;

/** Removes whitespace a user may type into an IČO ("270 74 358" → "27074358"). */
export function normalizeIco(input: string): string {
  return input.replace(/\s+/g, "");
}

/**
 * Checks a Czech company ID (IČO): exactly 8 digits, the last being a mod-11 check digit.
 * Expects an already normalized value; it says nothing about whether the company exists.
 */
export function isValidIco(ico: string): boolean {
  if (!ICO_FORMAT.test(ico)) {
    return false;
  }
  const digits = [...ico].map(Number);
  const sum = WEIGHTS.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0);
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === digits[7];
}
