import { isValidIco } from "@bystro/core";
import { z } from "zod";

/**
 * ARES: the Czech public register of economic subjects.
 * API: "ARES: REST API - veřejné", version 1.4, operation `vratEkonomickySubjekt`
 * (GET /ekonomicke-subjekty/{ico}). OpenAPI:
 * https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/v3/api-docs
 * No authentication. Everything it returns is external, untrusted text.
 */
export const ARES_DEFAULT_BASE_URL = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest";
const DEFAULT_TIMEOUT_MS = 5_000;

export interface AresCompany {
  ico: string;
  name: string;
  /** VAT ID, e.g. "CZ27074358". */
  dic: string | null;
  /** Street with house number, or "č.p. 63" where the place has no street names. */
  street: string | null;
  city: string | null;
  /** Five digits without a space. */
  postalCode: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Whether ARES lists an active VAT registration. */
  vatPayer: boolean;
}

export type AresLookupResult =
  | { status: "found"; company: AresCompany }
  | { status: "not_found" }
  /** ARES did not answer usefully (timeout, network, server error, unexpected body). */
  | { status: "unavailable" };

export interface AresLookupOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

// Only the fields we use; ARES sends many more and marks none as required.
const subjectSchema = z.object({
  ico: z.string(),
  obchodniJmeno: z.string(),
  dic: z.string().optional(),
  sidlo: z
    .object({
      kodStatu: z.string().optional(),
      nazevObce: z.string().optional(),
      nazevUlice: z.string().optional(),
      cisloDomovni: z.number().int().optional(),
      cisloOrientacni: z.number().int().optional(),
      cisloOrientacniPismeno: z.string().optional(),
      psc: z.number().int().optional(),
    })
    .optional(),
  seznamRegistraci: z.object({ stavZdrojeDph: z.string().optional() }).optional(),
});

type AresSubject = z.infer<typeof subjectSchema>;

function formatStreet(sidlo: NonNullable<AresSubject["sidlo"]>): string | null {
  const { nazevUlice, cisloDomovni, cisloOrientacni, cisloOrientacniPismeno } = sidlo;
  const orientation =
    cisloOrientacni === undefined ? "" : `/${cisloOrientacni}${cisloOrientacniPismeno ?? ""}`;
  if (nazevUlice !== undefined && nazevUlice !== "") {
    return cisloDomovni === undefined ? nazevUlice : `${nazevUlice} ${cisloDomovni}${orientation}`;
  }
  return cisloDomovni === undefined ? null : `č.p. ${cisloDomovni}`;
}

function toCompany(subject: AresSubject): AresCompany {
  const sidlo = subject.sidlo ?? {};
  return {
    ico: subject.ico,
    name: subject.obchodniJmeno.replace(/\s+/g, " ").trim(),
    dic: subject.dic ?? null,
    street: formatStreet(sidlo),
    city: sidlo.nazevObce ?? null,
    postalCode: sidlo.psc === undefined ? null : String(sidlo.psc).padStart(5, "0"),
    country: sidlo.kodStatu ?? "CZ",
    vatPayer: subject.seznamRegistraci?.stavZdrojeDph === "AKTIVNI",
  };
}

/**
 * Looks a company up in ARES by IČO. Makes exactly one request and never throws for
 * anything ARES does: callers fall back to manual entry on `not_found` / `unavailable`.
 * Throws only when `ico` is not a valid IČO (validate user input before calling).
 */
export async function lookupCompanyInAres(
  ico: string,
  options: AresLookupOptions = {},
): Promise<AresLookupResult> {
  if (!isValidIco(ico)) {
    throw new RangeError("lookupCompanyInAres expects a valid 8-digit IČO.");
  }
  const baseUrl = (options.baseUrl ?? ARES_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchFn = options.fetch ?? fetch;

  let response: Response;
  try {
    response = await fetchFn(`${baseUrl}/ekonomicke-subjekty/${ico}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 404) {
    return { status: "not_found" };
  }
  if (!response.ok) {
    return { status: "unavailable" };
  }

  const parsed = subjectSchema.safeParse(await response.json().catch(() => null));
  // A body for a different IČO would be a provider bug; never show it as the user's company.
  if (!parsed.success || parsed.data.ico !== ico) {
    return { status: "unavailable" };
  }
  return { status: "found", company: toCompany(parsed.data) };
}
