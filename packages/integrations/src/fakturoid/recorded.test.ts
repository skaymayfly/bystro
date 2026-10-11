import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { invoiceStatus } from "@bystro/core";
import { describe, expect, it } from "vitest";

import { mapFakturoidInvoice, mapFakturoidPayments, mapFakturoidSubject } from "./fakturoid";

/**
 * Responses recorded from a real test account with `pnpm --filter @bystro/integrations
 * record:fakturoid` (anonymised). Skipped until a recording exists.
 */
const dir = fileURLToPath(new URL("./fixtures/recorded/", import.meta.url));
const recorded = existsSync(`${dir}invoices.json`);
const load = (name: string): unknown[] =>
  JSON.parse(readFileSync(`${dir}${name}`, "utf8")) as unknown[];

describe.skipIf(!recorded)("recorded Fakturoid responses", () => {
  it("map without errors and keep the money consistent", () => {
    for (const raw of load("invoices.json")) {
      const invoice = mapFakturoidInvoice(raw);
      const payments = mapFakturoidPayments(raw);
      if (invoice === null) continue;
      expect(invoice.subtotalMinor + invoice.vatMinor).toBe(invoice.totalMinor);
      expect(invoice.lines.reduce((sum, line) => sum + line.totalMinor, 0n)).toBe(
        invoice.totalMinor,
      );
      expect(() => invoiceStatus(invoice, payments, "2026-10-11")).not.toThrow();
    }
  });

  it("subjects map without errors", () => {
    for (const raw of load("subjects.json")) {
      expect(() => mapFakturoidSubject(raw)).not.toThrow();
    }
  });
});
