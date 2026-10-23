import { describe, expect, it } from "vitest";

import {
  parseConnectOutcome,
  parseReturnTarget,
  readReturnTarget,
  returnCookie,
  returnPath,
} from "../server/connect-return";
import { readFakturoidEnv, readGmailEnv, readIdokladEnv, WebEnvError } from "../server/env";
import {
  connectOutcomeNotice,
  describeConnection,
  relativeTime,
  type ConnectionSummary,
} from "./connection-status";

const NOW = new Date("2026-10-11T08:00:00Z");
const connection = (overrides: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  provider: "fakturoid",
  status: "connected",
  needsAccount: false,
  lastSyncAt: "2026-10-11T07:48:00Z",
  lastErrorCode: null,
  updatedAt: "2026-10-11T07:59:30Z",
  ...overrides,
});

describe("relativeTime", () => {
  it("speaks in minutes, hours and days", () => {
    const ago = (ms: number) => relativeTime(new Date(NOW.getTime() - ms), NOW);
    expect(ago(20_000)).toBe("před chvílí");
    expect(ago(12 * 60_000)).toBe("před 12 min");
    expect(ago(3 * 60 * 60_000)).toBe("před 3 h");
    expect(ago(26 * 60 * 60_000)).toBe("včera");
    expect(ago(4 * 24 * 60 * 60_000)).toBe("před 4 dny");
    // A clock that is slightly ahead must not produce nonsense.
    expect(relativeTime(new Date(NOW.getTime() + 5_000), NOW)).toBe("před chvílí");
  });
});

describe("describeConnection", () => {
  it("shows when the data was last updated", () => {
    expect(describeConnection(connection(), NOW)).toEqual({
      tone: "ok",
      label: "Připojeno",
      text: "Aktualizováno před 12 min.",
      busy: false,
    });
  });

  it("is busy while syncing and before the first load", () => {
    expect(describeConnection(connection({ status: "syncing" }), NOW)).toMatchObject({
      label: "Synchronizuji…",
      busy: true,
    });
    expect(describeConnection(connection({ lastSyncAt: null }), NOW)).toMatchObject({
      label: "Čekám na první načtení",
      busy: true,
    });
  });

  it("stops pretending to wait when the first load takes too long", () => {
    const late = describeConnection(
      connection({ lastSyncAt: null, updatedAt: "2026-10-11T07:50:00Z" }),
      NOW,
    );
    expect(late).toMatchObject({ tone: "warn", label: "Načtení se zdrželo", busy: false });
    expect(late.text).toContain("Aktualizovat");
  });

  it("explains a sync that could not start", () => {
    expect(
      describeConnection(
        connection({ status: "error", lastErrorCode: "provider_not_configured" }),
        NOW,
      ).text,
    ).toContain("zatím není zapnuté");
  });

  it("asks for an account before anything else", () => {
    expect(
      describeConnection(connection({ needsAccount: true, status: "syncing" }), NOW),
    ).toMatchObject({ label: "Vyber účet", busy: false });
  });

  it("tells the user what to do when something is wrong", () => {
    expect(describeConnection(connection({ status: "reauth_required" }), NOW)).toMatchObject({
      tone: "error",
      label: "Je potřeba znovu připojit",
    });
    expect(
      describeConnection(connection({ status: "degraded", lastErrorCode: "rate_limited" }), NOW)
        .text,
    ).toContain("nepřijímá další dotazy");
    expect(
      describeConnection(connection({ status: "error", lastErrorCode: "account_blocked" }), NOW)
        .text,
    ).toContain("zablokovaný");
  });

  it("names the application the connection belongs to", () => {
    const idoklad = (overrides: Partial<ConnectionSummary>) =>
      describeConnection(connection({ provider: "idoklad", ...overrides }), NOW).text;

    expect(idoklad({ status: "reauth_required" })).toBe(
      "iDoklad mi přestal dávat přístup. Připoj ho prosím znovu.",
    );
    expect(idoklad({ status: "degraded", lastErrorCode: "rate_limited" })).toContain("iDoklad teď");
    expect(idoklad({ status: "error", lastErrorCode: "provider_not_configured" })).toContain(
      "z iDokladu",
    );
    // iDoklad refuses the API when the plan does not include it.
    expect(idoklad({ status: "error", lastErrorCode: "account_blocked" })).toContain("tarif");
    expect(
      describeConnection(connection({ status: "error", lastErrorCode: "forbidden" }), NOW).text,
    ).toBe("Tvůj účet ve Fakturoidu mi nedovolí číst faktury.");
    // An application we have no words for is not called by a wrong name.
    expect(
      describeConnection(connection({ provider: "pohoda", status: "reauth_required" }), NOW).text,
    ).toContain("Fakturační systém");
  });

  it("never shows an internal error code", () => {
    const described = describeConnection(
      connection({ status: "error", lastErrorCode: "TypeError" }),
      NOW,
    );
    expect(described.text).toBe("Zkus to prosím později. Kdyby to trvalo, napiš nám.");
  });
});

describe("returning from the provider", () => {
  it("goes back only to the two fixed pages", () => {
    expect(returnPath("settings", "ok")).toBe(
      "/app/nastaveni?karta=propojeni&propojeni=ok&aplikace=fakturoid",
    );
    expect(returnPath("onboarding", "zamitnuto", "idoklad")).toBe(
      "/onboarding?krok=2&propojeni=zamitnuto&aplikace=idoklad",
    );
    // The account is chosen in settings, wherever the user started.
    expect(returnPath("onboarding", "vybrat-ucet")).toBe(
      "/app/nastaveni?karta=propojeni&propojeni=vybrat-ucet&aplikace=fakturoid",
    );
    expect(parseReturnTarget("onboarding")).toBe("onboarding");
    expect(parseReturnTarget("https://evil.example")).toBe("settings");
    expect(parseReturnTarget(null)).toBe("settings");
  });

  it("remembers the page in a short-lived cookie the browser cannot read from scripts", () => {
    const cookie = returnCookie("onboarding", "https://bystro.example");
    expect(cookie).toContain("bystro_connect_return=onboarding");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(returnCookie("settings", "http://localhost:3000")).not.toContain("Secure");

    expect(readReturnTarget("a=1; bystro_connect_return=onboarding; b=2")).toBe("onboarding");
    expect(readReturnTarget("bystro_connect_return=%2F%2Fevil.example")).toBe("settings");
    expect(readReturnTarget(null)).toBe("settings");
  });

  it("has a sentence for every outcome and ignores unknown ones", () => {
    for (const outcome of [
      "ok",
      "vybrat-ucet",
      "zamitnuto",
      "neplatne",
      "nedostupne",
      "bez-uctu",
      "tarif",
    ]) {
      expect(parseConnectOutcome(outcome)).toBe(outcome);
      expect(connectOutcomeNotice(outcome, "fakturoid")?.text.length).toBeGreaterThan(10);
    }
    expect(parseConnectOutcome("<script>")).toBeNull();
    expect(connectOutcomeNotice("<script>", "fakturoid")).toBeNull();
    expect(connectOutcomeNotice(undefined, "fakturoid")).toBeNull();
  });

  it("names the application the outcome is about, and never echoes the query", () => {
    expect(connectOutcomeNotice("ok", "fakturoid")?.text).toBe(
      "Fakturoid je propojený. Faktury načtu během chvilky.",
    );
    expect(connectOutcomeNotice("ok", "idoklad")).toEqual({
      tone: "ok",
      text: "iDoklad je propojený. Faktury načtu během chvilky.",
    });
    expect(connectOutcomeNotice("bez-uctu", "idoklad")?.text).toContain("U iDokladu");
    expect(connectOutcomeNotice("tarif", "idoklad")?.text).toContain("tarif");
    const forged = connectOutcomeNotice("ok", "<script>alert(1)</script>");
    expect(forged?.text).toBe("Fakturační systém je propojený. Faktury načtu během chvilky.");
  });
});

describe("readIdokladEnv", () => {
  const complete = { IDOKLAD_CLIENT_ID: "idoklad-id", IDOKLAD_CLIENT_SECRET: "idoklad-secret" };

  it("is off when nothing is set and on when both variables are", () => {
    expect(readIdokladEnv({})).toBeNull();
    const settings = readIdokladEnv(complete);
    expect(settings?.clientId).toBe("idoklad-id");
    expect(settings?.clientSecret.reveal()).toBe("idoklad-secret");
    expect(settings?.baseUrl).toBeUndefined();
    expect(settings?.identityBaseUrl).toBeUndefined();
    expect(JSON.stringify(settings)).not.toContain("idoklad-secret");
  });

  it("refuses a half-finished configuration", () => {
    expect(() => readIdokladEnv({ IDOKLAD_CLIENT_ID: "idoklad-id" })).toThrow(WebEnvError);
    expect(() => readIdokladEnv({ IDOKLAD_CLIENT_SECRET: "idoklad-secret" })).toThrow(WebEnvError);
    expect(() => readIdokladEnv({ ...complete, IDOKLAD_BASE_URL: "not a url" })).toThrow(
      WebEnvError,
    );
    expect(() => readIdokladEnv({ ...complete, IDOKLAD_IDENTITY_BASE_URL: "nope" })).toThrow(
      WebEnvError,
    );
  });
});

describe("readFakturoidEnv", () => {
  const complete = {
    FAKTUROID_CLIENT_ID: "client-id",
    FAKTUROID_CLIENT_SECRET: "client-secret-value",
    INTEGRATIONS_CONTACT_EMAIL: "vyvoj@bystro.example",
  };

  it("is off when nothing is set and on when everything is", () => {
    expect(readFakturoidEnv({})).toBeNull();
    const settings = readFakturoidEnv(complete);
    expect(settings).toMatchObject({
      clientId: "client-id",
      userAgent: "Bystro (vyvoj@bystro.example)",
    });
    expect(settings?.baseUrl).toBeUndefined();
    expect(JSON.stringify(settings)).not.toContain("client-secret-value");
  });

  it("refuses a half-finished configuration", () => {
    expect(() => readFakturoidEnv({ ...complete, FAKTUROID_CLIENT_SECRET: "" })).toThrow(
      WebEnvError,
    );
    expect(() => readFakturoidEnv({ ...complete, INTEGRATIONS_CONTACT_EMAIL: "nobody" })).toThrow(
      WebEnvError,
    );
    expect(() => readFakturoidEnv({ ...complete, FAKTUROID_BASE_URL: "not a url" })).toThrow(
      WebEnvError,
    );
  });
});

describe("Gmail", () => {
  it("returns to Pošta when the user started there", () => {
    expect(returnPath("mail", "ok", "gmail")).toBe(
      "/app/posta?zdroj=propojeni&propojeni=ok&aplikace=gmail",
    );
    expect(parseReturnTarget("mail")).toBe("mail");
    expect(readReturnTarget("bystro_connect_return=mail")).toBe("mail");
  });

  it("speaks of the mailbox, not of invoices", () => {
    expect(connectOutcomeNotice("ok", "gmail")).toEqual({
      tone: "ok",
      text: "Gmail je propojený.",
    });
    expect(connectOutcomeNotice("opravneni", "gmail")?.text).toContain("s Gmailem");
    expect(connectOutcomeNotice("nedostupne", "gmail")?.text).toBe(
      "Gmail teď neodpovídá. Zkus to prosím za chvíli.",
    );
  });

  it("does not wait for a first load of a mailbox, which has no sync yet", () => {
    const mailbox = connection({
      provider: "gmail",
      category: "email",
      lastSyncAt: null,
      updatedAt: "2026-10-11T07:00:00Z",
    });
    expect(describeConnection(mailbox, NOW)).toEqual({
      tone: "ok",
      label: "Připojeno",
      text: null,
      busy: false,
    });
    expect(describeConnection({ ...mailbox, status: "reauth_required" }, NOW).text).toBe(
      "Gmail mi přestal dávat přístup. Připoj ho prosím znovu.",
    );
  });
});

describe("readGmailEnv", () => {
  const complete = { GMAIL_CLIENT_ID: "google-id", GMAIL_CLIENT_SECRET: "google-secret" };

  it("is off without variables and on with both", () => {
    expect(readGmailEnv({})).toBeNull();
    const settings = readGmailEnv(complete);
    expect(settings?.clientId).toBe("google-id");
    expect(settings?.clientSecret.reveal()).toBe("google-secret");
    expect(settings?.endpoints).toBeUndefined();
    expect(JSON.stringify(settings)).not.toContain("google-secret");
  });

  it("points everything at one stand-in for tests", () => {
    expect(
      readGmailEnv({ ...complete, GMAIL_TEST_BASE_URL: "http://localhost:3104" })?.endpoints,
    ).toEqual({
      authorization: "http://localhost:3104/o/oauth2/v2/auth",
      token: "http://localhost:3104/token",
      revocation: "http://localhost:3104/revoke",
      gmailApi: "http://localhost:3104/gmail/v1",
    });
  });

  it("refuses half a configuration", () => {
    expect(() => readGmailEnv({ GMAIL_CLIENT_ID: "google-id" })).toThrow(WebEnvError);
    expect(() => readGmailEnv({ ...complete, GMAIL_TEST_BASE_URL: "nope" })).toThrow(WebEnvError);
  });
});
