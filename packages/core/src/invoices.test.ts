import { describe, expect, it } from "vitest";

import type { DateOnly } from "./format";
import { DUE_SOON_DAYS, invoiceStatus, todayInPrague, type Invoice } from "./invoices";

type StatusInput = Pick<Invoice, "kind" | "sourceStatus" | "dueOn" | "totalMinor" | "currency">;

const invoice = (overrides: Partial<StatusInput> = {}): StatusInput => ({
  kind: "invoice",
  sourceStatus: "open",
  dueOn: "2026-10-15",
  totalMinor: 4_820_000n,
  currency: "CZK",
  ...overrides,
});

const czk = (amountMinor: bigint) => ({ amountMinor, currency: "CZK" });

describe("todayInPrague", () => {
  it("switches the day at midnight Prague time, not UTC (summer, UTC+2)", () => {
    expect(todayInPrague(new Date("2026-10-15T21:59:59Z"))).toBe("2026-10-15");
    expect(todayInPrague(new Date("2026-10-15T22:00:00Z"))).toBe("2026-10-16");
  });

  it("switches the day at midnight Prague time in winter (UTC+1)", () => {
    expect(todayInPrague(new Date("2026-12-31T22:59:59Z"))).toBe("2026-12-31");
    expect(todayInPrague(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");
  });

  it("keeps the right day around the change from summer to winter time", () => {
    // 25 October 2026: clocks go back from 3:00 to 2:00.
    expect(todayInPrague(new Date("2026-10-24T22:00:00Z"))).toBe("2026-10-25");
    expect(todayInPrague(new Date("2026-10-25T22:59:59Z"))).toBe("2026-10-25");
    expect(todayInPrague(new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-26");
  });
});

describe("invoiceStatus", () => {
  it("is not overdue on the due day itself, and overdue from the next day", () => {
    expect(invoiceStatus(invoice(), [], "2026-10-15")).toMatchObject({
      status: "due_soon",
      daysOverdue: 0,
    });
    expect(invoiceStatus(invoice(), [], "2026-10-16")).toMatchObject({
      status: "overdue",
      daysOverdue: 1,
    });
    expect(invoiceStatus(invoice(), [], "2026-11-14")).toMatchObject({
      status: "overdue",
      daysOverdue: 30,
    });
  });

  it("flips to overdue exactly at midnight in Prague", () => {
    const before = todayInPrague(new Date("2026-10-15T21:59:59Z"));
    const after = todayInPrague(new Date("2026-10-15T22:00:00Z"));
    expect(invoiceStatus(invoice(), [], before).status).toBe("due_soon");
    expect(invoiceStatus(invoice(), [], after).status).toBe("overdue");
  });

  it(`is due soon from ${DUE_SOON_DAYS} days before the due date`, () => {
    expect(invoiceStatus(invoice(), [], "2026-10-07").status).toBe("open");
    expect(invoiceStatus(invoice(), [], "2026-10-08").status).toBe("due_soon");
    expect(invoiceStatus(invoice(), [], "2026-10-14").status).toBe("due_soon");
  });

  it("counts days across month and year ends and the time change", () => {
    const dueEndOfYear = invoice({ dueOn: "2026-12-31" });
    expect(invoiceStatus(dueEndOfYear, [], "2027-01-01").daysOverdue).toBe(1);
    expect(invoiceStatus(dueEndOfYear, [], "2027-03-01").daysOverdue).toBe(60);
    // The night of 24/25 October has 25 hours; it is still one day.
    expect(invoiceStatus(invoice({ dueOn: "2026-10-24" }), [], "2026-10-26").daysOverdue).toBe(2);
  });

  it("reports what is left after payments in the invoice's currency", () => {
    const result = invoiceStatus(invoice(), [czk(1_000_000n)], "2026-10-20");
    expect(result).toEqual({
      status: "overdue",
      daysOverdue: 5,
      paidMinor: 1_000_000n,
      remainingMinor: 3_820_000n,
    });
  });

  it("a partial payment does not make it paid, not even one haléř short", () => {
    const result = invoiceStatus(invoice(), [czk(4_819_999n)], "2026-10-20");
    expect(result.status).toBe("overdue");
    expect(result.remainingMinor).toBe(1n);
  });

  it("is paid when payments cover the total exactly or more", () => {
    expect(invoiceStatus(invoice(), [czk(4_820_000n)], "2026-10-20")).toEqual({
      status: "paid",
      daysOverdue: 0,
      paidMinor: 4_820_000n,
      remainingMinor: 0n,
    });
    const split = [czk(2_000_000n), czk(2_820_000n)];
    expect(invoiceStatus(invoice(), split, "2026-10-20").status).toBe("paid");
    const overpaid = invoiceStatus(invoice(), [czk(5_000_000n)], "2026-10-20");
    expect(overpaid).toMatchObject({ status: "paid", remainingMinor: 0n });
  });

  it("ignores payments in another currency", () => {
    const result = invoiceStatus(
      invoice(),
      [{ amountMinor: 4_820_000n, currency: "EUR" }],
      "2026-10-20",
    );
    expect(result).toMatchObject({ status: "overdue", paidMinor: 0n });
  });

  it("trusts the invoicing system when it marks the invoice paid", () => {
    expect(invoiceStatus(invoice({ sourceStatus: "paid" }), [], "2026-12-01")).toEqual({
      status: "paid",
      daysOverdue: 0,
      paidMinor: 0n,
      remainingMinor: 0n,
    });
  });

  it("keeps drafts and cancelled invoices out of everything", () => {
    for (const sourceStatus of ["draft", "cancelled"] as const) {
      expect(invoiceStatus(invoice({ sourceStatus }), [], "2026-12-01")).toEqual({
        status: sourceStatus,
        daysOverdue: 0,
        paidMinor: 0n,
        remainingMinor: 0n,
      });
    }
  });

  it("never treats a credit note as due", () => {
    const creditNote = invoice({ kind: "credit_note", totalMinor: -500_000n });
    expect(invoiceStatus(creditNote, [], "2026-12-01")).toEqual({
      status: "open",
      daysOverdue: 0,
      paidMinor: 0n,
      remainingMinor: 0n,
    });
    expect(invoiceStatus({ ...creditNote, sourceStatus: "paid" }, [], "2026-12-01").status).toBe(
      "paid",
    );
  });

  it("treats a proforma like any other document that is due", () => {
    expect(invoiceStatus(invoice({ kind: "proforma" }), [], "2026-10-16").status).toBe("overdue");
  });

  it("refuses dates that do not exist", () => {
    expect(() => invoiceStatus(invoice(), [], "2026-02-30" as DateOnly)).toThrow(RangeError);
    expect(() =>
      invoiceStatus(invoice({ dueOn: "15.10.2026" as DateOnly }), [], "2026-10-16"),
    ).toThrow(RangeError);
  });
});
