import { describe, expect, it } from "vitest";

import { formatCzk, formatDate, formatWeekday, toDateParts, type DateOnly } from "./format";

/** Replaces non-breaking spaces so expectations stay readable. */
const plain = (value: string) => value.replaceAll(" ", " ");

describe("formatCzk", () => {
  it("formats whole crowns without decimals and groups thousands", () => {
    expect(plain(formatCzk(18_640_000))).toBe("186 400 Kč");
    expect(plain(formatCzk(0))).toBe("0 Kč");
    expect(plain(formatCzk(100))).toBe("1 Kč");
    expect(plain(formatCzk(99_900))).toBe("999 Kč");
    expect(plain(formatCzk(100_000))).toBe("1 000 Kč");
    expect(plain(formatCzk(123_456_789_00))).toBe("123 456 789 Kč");
  });

  it("shows haléře with two decimals and a decimal comma", () => {
    expect(plain(formatCzk(123_450))).toBe("1 234,50 Kč");
    expect(plain(formatCzk(5))).toBe("0,05 Kč");
    expect(plain(formatCzk(199))).toBe("1,99 Kč");
  });

  it("uses a typographic minus for negative amounts", () => {
    expect(plain(formatCzk(-7_400_000))).toBe("−74 000 Kč");
    expect(plain(formatCzk(-50))).toBe("−0,50 Kč");
  });

  it("joins number and currency with non-breaking spaces", () => {
    expect(formatCzk(18_640_000)).toBe("186 400 Kč");
  });

  it("accepts bigint beyond the safe integer range without losing precision", () => {
    expect(plain(formatCzk(900_719_925_474_099_312n))).toBe("9 007 199 254 740 993,12 Kč");
    expect(plain(formatCzk(-12_345n))).toBe("−123,45 Kč");
  });

  it("rejects numbers that are not whole haléře", () => {
    expect(() => formatCzk(10.5)).toThrow(RangeError);
    expect(() => formatCzk(Number.NaN)).toThrow(RangeError);
    expect(() => formatCzk(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatCzk(2 ** 53)).toThrow(RangeError);
  });
});

describe("formatDate", () => {
  it("formats a date-only value in the three styles", () => {
    expect(plain(formatDate("2026-10-02"))).toBe("2. 10. 2026");
    expect(plain(formatDate("2026-10-02", "short"))).toBe("2. 10.");
    expect(plain(formatDate("2026-10-02", "long"))).toBe("2. října");
    expect(plain(formatDate("2026-01-31", "long"))).toBe("31. ledna");
  });

  it("never shifts a date-only value, whatever the time zone", () => {
    expect(plain(formatDate("2026-01-01"))).toBe("1. 1. 2026");
    expect(plain(formatDate("2026-12-31"))).toBe("31. 12. 2026");
  });

  it("shows an instant on the day it falls on in Europe/Prague (winter, UTC+1)", () => {
    // 23:30 UTC on 31 Dec is already 00:30 on 1 Jan in Prague.
    expect(plain(formatDate(new Date("2026-12-31T23:30:00Z")))).toBe("1. 1. 2027");
    expect(plain(formatDate(new Date("2026-12-31T22:59:59Z")))).toBe("31. 12. 2026");
  });

  it("shows an instant on the day it falls on in Europe/Prague (summer, UTC+2)", () => {
    // 22:30 UTC on 30 Jun is 00:30 on 1 Jul in Prague.
    expect(plain(formatDate(new Date("2026-06-30T22:30:00Z")))).toBe("1. 7. 2026");
    expect(plain(formatDate(new Date("2026-06-30T21:59:59Z")))).toBe("30. 6. 2026");
  });

  it("handles the daylight-saving switches", () => {
    // Clocks go forward on 29 Mar 2026 and back on 25 Oct 2026.
    expect(plain(formatDate(new Date("2026-03-28T23:00:00Z")))).toBe("29. 3. 2026");
    expect(plain(formatDate(new Date("2026-03-29T22:00:00Z")))).toBe("30. 3. 2026");
    expect(plain(formatDate(new Date("2026-10-24T22:00:00Z")))).toBe("25. 10. 2026");
    expect(plain(formatDate(new Date("2026-10-25T23:00:00Z")))).toBe("26. 10. 2026");
  });

  it("rejects malformed or impossible dates", () => {
    expect(() => formatDate("2026-02-30")).toThrow(RangeError);
    expect(() => formatDate("2026-13-01" as DateOnly)).toThrow(RangeError);
    expect(() => formatDate("2. 10. 2026" as DateOnly)).toThrow(RangeError);
    expect(() => formatDate(new Date("nonsense"))).toThrow(RangeError);
  });
});

describe("formatWeekday", () => {
  it("names the weekday in Czech", () => {
    expect(formatWeekday("2026-10-02")).toBe("pátek");
    expect(formatWeekday("2026-10-04")).toBe("neděle");
    expect(formatWeekday("2026-10-05")).toBe("pondělí");
  });

  it("uses the Prague day for instants", () => {
    // Sunday 23:30 UTC is already Monday in Prague.
    expect(formatWeekday(new Date("2026-10-04T23:30:00Z"))).toBe("pondělí");
  });
});

describe("toDateParts", () => {
  it("returns numeric parts", () => {
    expect(toDateParts("2026-10-02")).toEqual({ year: 2026, month: 10, day: 2 });
    expect(toDateParts(new Date("2026-10-02T10:00:00Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 2,
    });
  });
});
