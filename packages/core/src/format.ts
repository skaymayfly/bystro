const LOCALE = "cs-CZ";
const TIME_ZONE = "Europe/Prague";
const NBSP = " ";
/** Typographic minus, as used in the prototype for negative amounts. */
const MINUS = "−";

const integerFormat = new Intl.NumberFormat(LOCALE, { useGrouping: true });

/**
 * Formats an amount given in haléře (minor units) as Czech crowns, e.g. `186 400 Kč`.
 * Whole crowns are shown without decimals, anything else with two (`1 234,50 Kč`).
 * Accepts `bigint`, or a `number` that is a safe integer; never a fractional number.
 */
export function formatCzk(amountMinor: bigint | number): string {
  if (typeof amountMinor === "number" && !Number.isSafeInteger(amountMinor)) {
    throw new RangeError("formatCzk expects a whole number of haléře within the safe range.");
  }
  const value = BigInt(amountMinor);
  const absolute = value < 0n ? -value : value;
  const crowns = integerFormat.format(absolute / 100n);
  const halere = absolute % 100n;
  const decimals = halere === 0n ? "" : `,${halere.toString().padStart(2, "0")}`;
  return `${value < 0n ? MINUS : ""}${crowns}${decimals}${NBSP}Kč`;
}

/** A calendar day without time, as `YYYY-MM-DD` (e.g. an invoice due date). */
export type DateOnly = `${number}-${number}-${number}`;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pragueParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Resolves the calendar day to show: a date-only string is taken as is (no time-zone
 * shift), an instant is converted to the day it falls on in Europe/Prague.
 */
export function toDateParts(value: Date | DateOnly): DateParts {
  if (typeof value === "string") {
    const match = DATE_ONLY.exec(value);
    const [year, month, day] = (match ?? []).slice(1).map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      throw new RangeError("Expected a date in the form YYYY-MM-DD.");
    }
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      throw new RangeError("Expected a real calendar date.");
    }
    return { year, month, day };
  }
  if (Number.isNaN(value.getTime())) {
    throw new RangeError("Expected a valid Date.");
  }
  const parts = Object.fromEntries(
    pragueParts.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

const MONTHS_GENITIVE = [
  "ledna",
  "února",
  "března",
  "dubna",
  "května",
  "června",
  "července",
  "srpna",
  "září",
  "října",
  "listopadu",
  "prosince",
] as const;

const WEEKDAYS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"] as const;

export type DateStyle = "numeric" | "short" | "long";

/**
 * Formats a day the Czech way:
 * - `numeric` (default): `2. 10. 2026`
 * - `short`: `2. 10.`
 * - `long`: `2. října`
 *
 * Instants are shown in Europe/Prague; date-only values are never shifted.
 */
export function formatDate(value: Date | DateOnly, style: DateStyle = "numeric"): string {
  const { year, month, day } = toDateParts(value);
  switch (style) {
    case "short":
      return `${day}.${NBSP}${month}.`;
    case "long":
      return `${day}.${NBSP}${MONTHS_GENITIVE[month - 1]}`;
    case "numeric":
      return `${day}.${NBSP}${month}.${NBSP}${year}`;
  }
}

/** Czech weekday name in lower case, e.g. `pátek`. */
export function formatWeekday(value: Date | DateOnly): string {
  const { year, month, day } = toDateParts(value);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] as string;
}
