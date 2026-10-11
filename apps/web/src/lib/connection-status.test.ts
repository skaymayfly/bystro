import { describe, expect, it } from "vitest";

import {
  parseConnectOutcome,
  parseReturnTarget,
  readReturnTarget,
  returnCookie,
  returnPath,
} from "../server/connect-return";
import { readFakturoidEnv, WebEnvError } from "../server/env";
import {
  CONNECT_OUTCOME_TEXTS,
  describeConnection,
  relativeTime,
  type ConnectionSummary,
} from "./connection-status";

const NOW = new Date("2026-10-11T08:00:00Z");
const connection = (overrides: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  status: "connected",
  needsAccount: false,
  lastSyncAt: "2026-10-11T07:48:00Z",
  lastErrorCode: null,
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
    expect(returnPath("settings", "ok")).toBe("/app/nastaveni?karta=propojeni&propojeni=ok");
    expect(returnPath("onboarding", "zamitnuto")).toBe("/onboarding?krok=2&propojeni=zamitnuto");
    // The account is chosen in settings, wherever the user started.
    expect(returnPath("onboarding", "vybrat-ucet")).toBe(
      "/app/nastaveni?karta=propojeni&propojeni=vybrat-ucet",
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
    ]) {
      expect(parseConnectOutcome(outcome)).toBe(outcome);
      expect(CONNECT_OUTCOME_TEXTS[outcome]?.text.length).toBeGreaterThan(10);
    }
    expect(parseConnectOutcome("<script>")).toBeNull();
    expect(CONNECT_OUTCOME_TEXTS["<script>"]).toBeUndefined();
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
