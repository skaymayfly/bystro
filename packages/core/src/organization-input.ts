import { z } from "zod";

import { isValidIco, normalizeIco } from "./ico";

const MAX_TEXT = 200;

/** Optional free text: trimmed, empty or missing becomes `null`. */
const optionalText = z
  .string()
  .trim()
  .max(MAX_TEXT)
  .nullish()
  .transform((value) => (value === undefined || value === null || value === "" ? null : value));

/** Czech VAT ID: country prefix + 8–10 digits, e.g. "CZ27074358". Spaces are ignored. */
const dic = z
  .string()
  .nullish()
  .transform((value) => (value ?? "").replace(/\s+/g, "").toUpperCase())
  .refine((value) => value === "" || /^CZ\d{8,10}$/.test(value), {
    message: "DIČ must look like CZ12345678.",
  })
  .transform((value) => (value === "" ? null : value));

/** Czech postal code: five digits; "140 00" is accepted and stored as "14000". */
const postalCode = z
  .string()
  .nullish()
  .transform((value) => (value ?? "").replace(/\s+/g, ""))
  .refine((value) => value === "" || /^\d{5}$/.test(value), {
    message: "Postal code must have 5 digits.",
  })
  .transform((value) => (value === "" ? null : value));

/**
 * What a user submits to create their company. Parsing normalizes the values
 * (trimmed text, IČO and PSČ without spaces) and validates the IČO check digit.
 */
export const organizationInputSchema = z.object({
  name: z.string().trim().min(1).max(MAX_TEXT),
  ico: z.string().transform(normalizeIco).refine(isValidIco, { message: "Invalid IČO." }),
  dic,
  street: optionalText,
  city: optionalText,
  postalCode,
  vatPayer: z.boolean().default(false),
});

export type OrganizationInput = z.output<typeof organizationInputSchema>;
