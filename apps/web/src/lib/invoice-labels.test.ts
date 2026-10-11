import { describe, expect, it } from "vitest";

import {
  daysLabel,
  formatQuantity,
  invoiceCountLabel,
  invoiceListHref,
  invoiceStatusLabel,
  overdueSentence,
  parseFilter,
  parseSort,
} from "./invoice-labels";

describe("Czech plurals", () => {
  it("declines days", () => {
    expect([1, 2, 4, 5, 12, 21].map(daysLabel)).toEqual([
      "1 den",
      "2 dny",
      "4 dny",
      "5 dní",
      "12 dní",
      "21 dní",
    ]);
  });

  it("declines invoices", () => {
    expect([0, 1, 3, 5, 8].map(invoiceCountLabel)).toEqual([
      "0 faktur",
      "1 faktura",
      "3 faktury",
      "5 faktur",
      "8 faktur",
    ]);
  });

  it("builds the invoice part of the Přehled sentence", () => {
    expect([0, 1, 2, 5].map(overdueSentence)).toEqual([
      "faktury jsou v pořádku",
      "1 faktura je po splatnosti",
      "2 faktury jsou po splatnosti",
      "5 faktur je po splatnosti",
    ]);
  });
});

describe("invoiceStatusLabel", () => {
  const label = (status: "overdue" | "due_soon" | "open" | "paid", days = 0) =>
    invoiceStatusLabel({ status, daysOverdue: days, daysUntilDue: days });

  it("says how long an invoice is overdue", () => {
    expect(label("overdue", 12)).toEqual({ label: "12 dní po splatnosti", tone: "danger" });
    expect(label("overdue", 1).label).toBe("1 den po splatnosti");
  });

  it("says when an invoice is due soon", () => {
    expect(label("due_soon", 0).label).toBe("Splatná dnes");
    expect(label("due_soon", 1).label).toBe("Splatná zítra");
    expect(label("due_soon", 4)).toEqual({ label: "Splatná za 4 dny", tone: "neutral" });
  });

  it("names waiting and paid invoices", () => {
    expect(label("open", 30)).toEqual({ label: "Čeká na platbu", tone: "neutral" });
    expect(label("paid")).toEqual({ label: "Zaplaceno", tone: "success" });
  });
});

describe("list address", () => {
  it("reads the filter and the sort from the address and ignores nonsense", () => {
    expect(parseFilter("po-splatnosti")).toBe("overdue");
    expect(parseFilter("brzy-splatne")).toBe("due_soon");
    expect(parseFilter("ceka")).toBe("pending");
    expect(parseFilter("zaplaceno")).toBe("paid");
    expect(parseFilter(undefined)).toBe("all");
    expect(parseFilter("'; drop table invoices")).toBe("all");
    expect(parseFilter(["po-splatnosti", "zaplaceno"])).toBe("all");

    expect(parseSort("castka")).toBe("amount");
    expect(parseSort("klient")).toBe("client");
    expect(parseSort("cislo")).toBe("number");
    expect(parseSort("nesmysl")).toBe("due");
  });

  it("leaves defaults out and encodes the search", () => {
    expect(invoiceListHref({ filter: "all", sort: "due", query: "" })).toBe("/app/faktury");
    expect(invoiceListHref({ filter: "overdue", sort: "due", query: "" })).toBe(
      "/app/faktury?stav=po-splatnosti",
    );
    expect(invoiceListHref({ filter: "paid", sort: "amount", query: "Novák & syn" })).toBe(
      "/app/faktury?stav=zaplaceno&q=Nov%C3%A1k+%26+syn&razeni=castka",
    );
  });
});

describe("formatQuantity", () => {
  it("writes thousandths the Czech way", () => {
    expect(formatQuantity(1_000)).toBe("1");
    expect(formatQuantity(1_500)).toBe("1,5");
    expect(formatQuantity(125)).toBe("0,125");
  });
});
