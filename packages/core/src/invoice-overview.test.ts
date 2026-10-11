import { describe, expect, it } from "vitest";

import { formatMoney } from "./format";
import {
  buildInvoiceRows,
  daysBetween,
  filterInvoiceRows,
  sortInvoiceRows,
  summarizeInvoices,
  type InvoiceOverviewInput,
} from "./invoice-overview";

const TODAY = "2026-10-11";

const invoice = (
  overrides: Partial<InvoiceOverviewInput> & { id: string },
): InvoiceOverviewInput => ({
  number: `2026-${overrides.id}`,
  kind: "invoice",
  sourceStatus: "open",
  issuedOn: "2026-09-20",
  dueOn: "2026-10-25",
  paidOn: null,
  currency: "CZK",
  totalMinor: 100_000n,
  paidMinor: 0n,
  clientName: "Novák s.r.o.",
  ...overrides,
});

const sample = () =>
  buildInvoiceRows(
    [
      invoice({
        id: "01",
        dueOn: "2026-09-29",
        totalMinor: 11_200_000n,
        clientName: "Novák s.r.o.",
      }),
      invoice({
        id: "02",
        dueOn: "2026-10-06",
        totalMinor: 1_840_000n,
        clientName: "Pekárna U Mlýna",
      }),
      invoice({
        id: "03",
        dueOn: "2026-10-15",
        totalMinor: 12_800_000n,
        clientName: "Zelený dům a.s.",
      }),
      invoice({ id: "04", dueOn: "2026-11-30", totalMinor: 4_250_000n, clientName: "Stavby Kříž" }),
      invoice({
        id: "05",
        dueOn: "2026-09-28",
        sourceStatus: "paid",
        paidOn: "2026-09-26",
        totalMinor: 2_360_000n,
        paidMinor: 2_360_000n,
        clientName: "Kavárna Prostor",
      }),
      invoice({ id: "06", sourceStatus: "cancelled", clientName: "Storno a.s." }),
      invoice({ id: "07", sourceStatus: "draft", clientName: "Koncept" }),
    ],
    TODAY,
  );

describe("daysBetween", () => {
  it("counts whole calendar days in both directions", () => {
    expect(daysBetween("2026-10-11", "2026-10-25")).toBe(14);
    expect(daysBetween("2026-10-11", "2026-10-11")).toBe(0);
    expect(daysBetween("2026-10-11", "2026-09-29")).toBe(-12);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
});

describe("buildInvoiceRows", () => {
  it("gives every invoice its status for the day and drops drafts and cancelled ones", () => {
    const rows = sample();
    expect(rows.map((row) => [row.id, row.status, row.daysOverdue, row.daysUntilDue])).toEqual([
      ["01", "overdue", 12, -12],
      ["02", "overdue", 5, -5],
      ["03", "due_soon", 0, 4],
      ["04", "open", 0, 50],
      ["05", "paid", 0, -13],
    ]);
  });

  it("keeps a partly paid invoice unpaid and shows what is left", () => {
    const [row] = buildInvoiceRows(
      [invoice({ id: "08", dueOn: "2026-10-01", totalMinor: 100_000n, paidMinor: 40_000n })],
      TODAY,
    );
    expect(row).toMatchObject({ status: "overdue", remainingMinor: 60_000n });
  });
});

describe("filterInvoiceRows", () => {
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  it("filters by status; pending means not yet due, soon or later", () => {
    const rows = sample();
    expect(ids(filterInvoiceRows(rows, { filter: "all" }))).toHaveLength(5);
    expect(ids(filterInvoiceRows(rows, { filter: "overdue" }))).toEqual(["01", "02"]);
    expect(ids(filterInvoiceRows(rows, { filter: "due_soon" }))).toEqual(["03"]);
    expect(ids(filterInvoiceRows(rows, { filter: "pending" }))).toEqual(["03", "04"]);
    expect(ids(filterInvoiceRows(rows, { filter: "paid" }))).toEqual(["05"]);
  });

  it("searches client and number without caring about case or diacritics", () => {
    const rows = sample();
    expect(ids(filterInvoiceRows(rows, { query: "novak" }))).toEqual(["01"]);
    expect(ids(filterInvoiceRows(rows, { query: "  ZELENÝ " }))).toEqual(["03"]);
    expect(ids(filterInvoiceRows(rows, { query: "2026-04" }))).toEqual(["04"]);
    expect(ids(filterInvoiceRows(rows, { query: "kriz", filter: "overdue" }))).toEqual([]);
    expect(ids(filterInvoiceRows(rows, { query: "nic takového" }))).toEqual([]);
  });
});

describe("sortInvoiceRows", () => {
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  it("by default puts the longest overdue on top and paid invoices last", () => {
    expect(ids(sortInvoiceRows(sample().reverse()))).toEqual(["01", "02", "03", "04", "05"]);
  });

  it("sorts by amount, number and client name in Czech order", () => {
    const rows = sample();
    expect(ids(sortInvoiceRows(rows, "amount"))).toEqual(["03", "01", "04", "05", "02"]);
    expect(ids(sortInvoiceRows(rows, "number"))).toEqual(["05", "04", "03", "02", "01"]);
    expect(sortInvoiceRows(rows, "client").map((row) => row.clientName)).toEqual([
      "Kavárna Prostor",
      "Novák s.r.o.",
      "Pekárna U Mlýna",
      "Stavby Kříž",
      "Zelený dům a.s.",
    ]);
  });

  it("does not change the list it was given", () => {
    const rows = sample().reverse();
    const before = rows.map((row) => row.id);
    sortInvoiceRows(rows);
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe("summarizeInvoices", () => {
  it("sums what is overdue, what is waiting and what was paid", () => {
    const summary = summarizeInvoices(sample());
    expect(summary.overdue).toEqual({ count: 2, sumMinor: 13_040_000n });
    expect(summary.pending).toEqual({ count: 2, sumMinor: 17_050_000n });
    expect(summary.paid).toEqual({ count: 1, sumMinor: 2_360_000n });
    expect(summary.oldestOverdue?.id).toBe("01");
    expect(summary.otherCurrencyCount).toBe(0);
  });

  it("counts the unpaid remainder, not the whole invoice", () => {
    const rows = buildInvoiceRows(
      [invoice({ id: "08", dueOn: "2026-10-01", totalMinor: 100_000n, paidMinor: 40_000n })],
      TODAY,
    );
    expect(summarizeInvoices(rows).overdue).toEqual({ count: 1, sumMinor: 60_000n });
  });

  it("never adds another currency to the crown sums", () => {
    const rows = buildInvoiceRows(
      [
        invoice({ id: "09", dueOn: "2026-10-01", totalMinor: 100_000n }),
        invoice({ id: "10", dueOn: "2026-10-01", totalMinor: 500_000n, currency: "EUR" }),
      ],
      TODAY,
    );
    const summary = summarizeInvoices(rows);
    expect(summary.overdue).toEqual({ count: 2, sumMinor: 100_000n });
    expect(summary.otherCurrencyCount).toBe(1);
  });

  it("is empty for no invoices", () => {
    expect(summarizeInvoices([])).toMatchObject({
      overdue: { count: 0, sumMinor: 0n },
      oldestOverdue: null,
    });
  });
});

describe("formatMoney", () => {
  it("writes crowns the usual way and other currencies with their code", () => {
    expect(formatMoney(4_820_000n, "CZK")).toBe("48 200 Kč");
    expect(formatMoney(123_450n, "EUR")).toBe("1 234,50 EUR");
    expect(formatMoney(-50_000n, "EUR")).toBe("−500 EUR");
  });
});
