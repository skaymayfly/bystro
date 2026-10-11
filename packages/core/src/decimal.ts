/**
 * Exact conversion of decimal numbers written as text (as APIs send money, e.g. "9133.6")
 * into whole minor units. Never goes through a floating-point number.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Thrown when a text is not a decimal number or would lose digits. */
export class DecimalFormatError extends RangeError {
  override name = "DecimalFormatError";
}

/**
 * Parses `value` and scales it by 10^`scale`: `parseScaledDecimal("9133.6", 2)` is
 * `913360n`. Extra decimal places are allowed only when they are zeros; anything that would
 * have to be rounded is refused.
 */
export function parseScaledDecimal(value: string, scale: number): bigint {
  const match = DECIMAL.exec(value.trim());
  if (match === null) {
    throw new DecimalFormatError("Expected a decimal number such as 1234.5.");
  }
  const [, sign, whole = "0", fraction = ""] = match;
  const kept = fraction.slice(0, scale);
  if (/[^0]/.test(fraction.slice(scale))) {
    throw new DecimalFormatError(`The number has more than ${scale} decimal places.`);
  }
  const digits = BigInt(whole + kept.padEnd(scale, "0"));
  return sign === "-" ? -digits : digits;
}

/** Money in minor units: `"11000.0"` → `1100000n` (haléře). */
export function parseMoneyToMinor(value: string): bigint {
  return parseScaledDecimal(value, 2);
}

/** A scaled decimal that must fit a safe JS integer, e.g. quantities in thousandths. */
export function parseScaledSafeInteger(value: string, scale: number): number {
  const scaled = parseScaledDecimal(value, scale);
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER) || scaled < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new DecimalFormatError("The number is too large.");
  }
  return Number(scaled);
}
