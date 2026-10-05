import { describe, expect, it } from "vitest";

import { lookupCompanyInAres } from "./ares";
// Recorded from the public ARES API on 2026-10-05 (legal entities only, no natural persons).
import foundCompany from "./fixtures/found-company.json";
import foundNoStreet from "./fixtures/found-no-street.json";
import invalidInput from "./fixtures/invalid-input.json";
import notFound from "./fixtures/not-found.json";

/** Builds a fake `fetch` that records requested URLs and answers with the given fixture. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("lookupCompanyInAres", () => {
  it("maps a found company with a street address", async () => {
    const { calls, fetchFn } = fakeFetch(200, foundCompany);

    const result = await lookupCompanyInAres("27074358", { fetch: fetchFn });

    expect(result).toEqual({
      status: "found",
      company: {
        ico: "27074358",
        name: "Asseco Central Europe, a.s.",
        dic: "CZ27074358",
        street: "Budějovická 778/3a",
        city: "Praha",
        postalCode: "14000",
        country: "CZ",
        vatPayer: true,
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/27074358",
    );
    expect(calls[0]?.init?.headers).toEqual({ Accept: "application/json" });
  });

  it("maps an address without a street name and keeps leading zeros of the IČO", async () => {
    const { fetchFn } = fakeFetch(200, foundNoStreet);

    const result = await lookupCompanyInAres("00573418", { fetch: fetchFn });

    expect(result).toMatchObject({
      status: "found",
      company: {
        ico: "00573418",
        name: "Obec Modrava",
        street: "č.p. 63",
        city: "Modrava",
        postalCode: "34192",
        country: "CZ",
      },
    });
  });

  it("reports not_found for ARES's 404 answer", async () => {
    const { fetchFn } = fakeFetch(404, notFound);
    expect(await lookupCompanyInAres("99999994", { fetch: fetchFn })).toEqual({
      status: "not_found",
    });
  });

  it("uses a custom base URL and tolerates a trailing slash", async () => {
    const { calls, fetchFn } = fakeFetch(404, notFound);
    await lookupCompanyInAres("99999994", { fetch: fetchFn, baseUrl: "http://localhost:3101/" });
    expect(calls[0]?.url).toBe("http://localhost:3101/ekonomicke-subjekty/99999994");
  });

  it("reports unavailable for server errors and other unexpected statuses", async () => {
    for (const [status, body] of [
      [500, { kod: "OBECNA_CHYBA", popis: "Neočekávaná chyba" }],
      [503, "<html>Service Unavailable</html>"],
      [400, invalidInput],
      [429, ""],
    ] as const) {
      const { fetchFn } = fakeFetch(status, body);
      expect(await lookupCompanyInAres("27074358", { fetch: fetchFn }), String(status)).toEqual({
        status: "unavailable",
      });
    }
  });

  it("reports unavailable on a network failure or timeout", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await lookupCompanyInAres("27074358", { fetch: failing })).toEqual({
      status: "unavailable",
    });

    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    expect(await lookupCompanyInAres("27074358", { fetch: hanging, timeoutMs: 20 })).toEqual({
      status: "unavailable",
    });
  });

  it("reports unavailable when the body is not what the API documents", async () => {
    for (const body of ["not json", {}, { ico: "27074358" }, { obchodniJmeno: 42 }, null]) {
      const { fetchFn } = fakeFetch(200, body);
      expect(await lookupCompanyInAres("27074358", { fetch: fetchFn })).toEqual({
        status: "unavailable",
      });
    }
  });

  it("never returns a company whose IČO differs from the one asked for", async () => {
    const { fetchFn } = fakeFetch(200, foundCompany);
    expect(await lookupCompanyInAres("00573418", { fetch: fetchFn })).toEqual({
      status: "unavailable",
    });
  });

  it("copes with a subject that has no address, DIČ or registrations", async () => {
    const { fetchFn } = fakeFetch(200, { ico: "27074358", obchodniJmeno: "  Firma   bez  údajů " });
    expect(await lookupCompanyInAres("27074358", { fetch: fetchFn })).toEqual({
      status: "found",
      company: {
        ico: "27074358",
        name: "Firma bez údajů",
        dic: null,
        street: null,
        city: null,
        postalCode: null,
        country: "CZ",
        vatPayer: false,
      },
    });
  });

  it("refuses an invalid IČO without calling ARES", async () => {
    const { calls, fetchFn } = fakeFetch(200, foundCompany);
    await expect(lookupCompanyInAres("27074359", { fetch: fetchFn })).rejects.toThrow(RangeError);
    await expect(lookupCompanyInAres("../admin", { fetch: fetchFn })).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});
