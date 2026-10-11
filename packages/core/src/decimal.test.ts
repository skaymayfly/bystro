import { describe, expect, it } from "vitest";

import {
  DecimalFormatError,
  parseMoneyToMinor,
  parseScaledDecimal,
  parseScaledSafeInteger,
} from "./decimal";
import { ProviderError } from "./provider-error";

describe("parseMoneyToMinor", () => {
  it("converts amounts as APIs write them into haléře exactly", () => {
    expect(parseMoneyToMinor("11000.0")).toBe(1_100_000n);
    expect(parseMoneyToMinor("9133.6")).toBe(913_360n);
    expect(parseMoneyToMinor("173.92")).toBe(17_392n);
    expect(parseMoneyToMinor("0")).toBe(0n);
    expect(parseMoneyToMinor("-500.5")).toBe(-50_050n);
  });

  it("keeps digits a floating-point number would lose", () => {
    expect(parseMoneyToMinor("0.1")).toBe(10n);
    expect(parseMoneyToMinor("90071992547409.93")).toBe(9_007_199_254_740_993n);
  });

  it("accepts extra decimal places only when they are zeros", () => {
    expect(parseMoneyToMinor("1210.000")).toBe(121_000n);
    expect(() => parseMoneyToMinor("1210.005")).toThrow(DecimalFormatError);
  });

  it("refuses anything that is not a plain decimal number", () => {
    for (const value of ["", "abc", "1,5", "1e3", "12.", ".5", "1 000", "+1", "NaN"]) {
      expect(() => parseMoneyToMinor(value), value).toThrow(DecimalFormatError);
    }
  });
});

describe("parseScaledDecimal and parseScaledSafeInteger", () => {
  it("scales quantities to thousandths", () => {
    expect(parseScaledDecimal("1.5", 3)).toBe(1_500n);
    expect(parseScaledSafeInteger("5.0", 3)).toBe(5_000);
    expect(parseScaledSafeInteger("0.125", 3)).toBe(125);
  });

  it("refuses values that do not fit a safe integer", () => {
    expect(() => parseScaledSafeInteger("9007199254740.992", 3)).toThrow(DecimalFormatError);
  });
});

describe("ProviderError", () => {
  it("says whether retrying makes sense and never carries more than the code", () => {
    expect(new ProviderError("rate_limited", 5_000)).toMatchObject({
      retryable: true,
      retryAfterMs: 5_000,
      message: "Provider error: rate_limited",
    });
    expect(new ProviderError("provider_unavailable").retryable).toBe(true);
    expect(new ProviderError("reauth_required").retryable).toBe(false);
    expect(new ProviderError("invalid_response").retryAfterMs).toBeNull();
  });
});
