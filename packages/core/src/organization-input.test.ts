import { describe, expect, it } from "vitest";

import { organizationInputSchema } from "./organization-input";

const valid = {
  name: "  Dvořák Interiéry s.r.o. ",
  ico: "270 74 358",
  dic: "cz 27074358",
  street: " Dlouhá 12 ",
  city: "Praha",
  postalCode: "110 00",
  vatPayer: true,
};

describe("organizationInputSchema", () => {
  it("normalizes a complete input", () => {
    expect(organizationInputSchema.parse(valid)).toEqual({
      name: "Dvořák Interiéry s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      street: "Dlouhá 12",
      city: "Praha",
      postalCode: "11000",
      vatPayer: true,
    });
  });

  it("needs only a name and an IČO; the rest becomes null or false", () => {
    expect(organizationInputSchema.parse({ name: "Firma", ico: "27074358" })).toEqual({
      name: "Firma",
      ico: "27074358",
      dic: null,
      street: null,
      city: null,
      postalCode: null,
      vatPayer: false,
    });
    expect(
      organizationInputSchema.parse({
        name: "Firma",
        ico: "27074358",
        dic: "",
        street: "   ",
        city: null,
        postalCode: "",
      }),
    ).toMatchObject({ dic: null, street: null, city: null, postalCode: null });
  });

  it("rejects a missing or blank name", () => {
    expect(organizationInputSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(organizationInputSchema.safeParse({ ico: "27074358" }).success).toBe(false);
  });

  it("rejects an IČO with a wrong check digit or wrong length", () => {
    for (const ico of ["27074359", "2707435", "abcdefgh", ""]) {
      expect(organizationInputSchema.safeParse({ ...valid, ico }).success, ico).toBe(false);
    }
  });

  it("rejects a malformed DIČ or postal code", () => {
    expect(organizationInputSchema.safeParse({ ...valid, dic: "27074358" }).success).toBe(false);
    expect(organizationInputSchema.safeParse({ ...valid, dic: "CZ12" }).success).toBe(false);
    expect(organizationInputSchema.safeParse({ ...valid, postalCode: "1100" }).success).toBe(false);
    expect(organizationInputSchema.safeParse({ ...valid, postalCode: "abcde" }).success).toBe(
      false,
    );
  });

  it("rejects overlong text and non-boolean flags", () => {
    expect(organizationInputSchema.safeParse({ ...valid, name: "x".repeat(201) }).success).toBe(
      false,
    );
    expect(organizationInputSchema.safeParse({ ...valid, vatPayer: "yes" }).success).toBe(false);
  });
});
