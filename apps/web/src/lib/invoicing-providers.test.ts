import { describe, expect, it } from "vitest";

import {
  describeInvoicingSources,
  parseInvoicingProvider,
  providerWording,
} from "./invoicing-providers";

describe("providerWording", () => {
  it("knows the invoicing systems and nothing else", () => {
    expect(parseInvoicingProvider("fakturoid")).toBe("fakturoid");
    expect(parseInvoicingProvider("idoklad")).toBe("idoklad");
    expect(parseInvoicingProvider("iDoklad")).toBeNull();
    expect(parseInvoicingProvider(undefined)).toBeNull();

    expect(providerWording("idoklad")).toEqual({
      name: "iDoklad",
      of: "iDokladu",
      inside: "v iDokladu",
      withIt: "s iDokladem",
    });
    expect(providerWording("fakturoid").inside).toBe("ve Fakturoidu");
    expect(providerWording("<b>x</b>").name).toBe("Fakturační systém");
  });
});

describe("describeInvoicingSources", () => {
  it("is null when no invoicing system is connected", () => {
    expect(describeInvoicingSources([])).toBeNull();
    expect(describeInvoicingSources([{ provider: "fio", lastSyncAt: null }])).toBeNull();
  });

  it("describes one source", () => {
    expect(
      describeInvoicingSources([{ provider: "idoklad", lastSyncAt: "2026-10-11T07:00:00Z" }]),
    ).toEqual({
      names: "iDoklad",
      connected: "iDoklad je propojený",
      inside: "V iDokladu",
      lastSyncAt: "2026-10-11T07:00:00Z",
      loading: false,
    });
  });

  it("names two sources in a fixed order and reports the older update", () => {
    expect(
      describeInvoicingSources([
        { provider: "idoklad", lastSyncAt: "2026-10-11T06:00:00.000Z" },
        { provider: "fakturoid", lastSyncAt: "2026-10-11T07:00:00.000Z" },
      ]),
    ).toEqual({
      names: "Fakturoid a iDoklad",
      connected: "Fakturoid a iDoklad jsou propojené",
      inside: "Ve Fakturoidu a v iDokladu",
      lastSyncAt: "2026-10-11T06:00:00.000Z",
      loading: false,
    });
  });

  it("is loading until every source has been read", () => {
    const first = describeInvoicingSources([
      { provider: "fakturoid", lastSyncAt: "2026-10-11T07:00:00Z" },
      { provider: "idoklad", lastSyncAt: null },
    ]);
    expect(first).toMatchObject({ loading: true, lastSyncAt: "2026-10-11T07:00:00Z" });

    expect(describeInvoicingSources([{ provider: "fakturoid", lastSyncAt: null }])).toMatchObject({
      loading: true,
      lastSyncAt: null,
    });
  });
});
