import { describe, expect, it } from "vitest";

import { isValidIco, normalizeIco } from "./ico";

describe("isValidIco", () => {
  it("accepts real IČO values, including ones with leading zeros", () => {
    for (const ico of ["27074358", "00573418", "45274649", "00000019", "99999994"]) {
      expect(isValidIco(ico), ico).toBe(true);
    }
  });

  it("rejects a wrong check digit", () => {
    for (const ico of ["27074359", "27074350", "00573419", "12345678"]) {
      expect(isValidIco(ico), ico).toBe(false);
    }
  });

  it("handles the remainders where the check digit wraps to 0 and 1", () => {
    // sum % 11 === 1 → check digit 0; sum % 11 === 0 → check digit 1
    expect(isValidIco("00000060")).toBe(true);
    expect(isValidIco("00000061")).toBe(false);
    expect(isValidIco("00002101")).toBe(true);
    expect(isValidIco("00002100")).toBe(false);
  });

  it("rejects anything that is not exactly 8 digits", () => {
    for (const ico of ["", "2707435", "270743588", "2707435a", "27 074 358", "CZ27074358"]) {
      expect(isValidIco(ico), ico).toBe(false);
    }
  });
});

describe("normalizeIco", () => {
  it("removes spaces so a formatted IČO validates", () => {
    expect(normalizeIco(" 270 74 358 ")).toBe("27074358");
    expect(isValidIco(normalizeIco("270\u00a074\u00a0358"))).toBe(true);
  });

  it("does not pad or otherwise repair the value", () => {
    expect(normalizeIco("573418")).toBe("573418");
    expect(isValidIco(normalizeIco("573418"))).toBe(false);
  });
});
