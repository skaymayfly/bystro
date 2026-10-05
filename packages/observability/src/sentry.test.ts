import { describe, expect, it } from "vitest";

import { scrubSentryEvent, SENTRY_BASE_OPTIONS } from "./sentry";

const EMAIL = "jan.novak@example.cz";
const TOKEN = "reset-token-abc123";

describe("scrubSentryEvent", () => {
  it("keeps only method and path of the request", () => {
    const event = scrubSentryEvent({
      request: {
        method: "POST",
        url: `https://app.bystro.cz/obnova-hesla?token=${TOKEN}#x`,
        query_string: `token=${TOKEN}`,
        cookies: { "better-auth.session_token": "session-secret" },
        headers: { cookie: "session-secret", authorization: "Bearer abc", "user-agent": "x" },
        data: { password: "hunter2", email: EMAIL },
      },
    });

    expect(event.request).toEqual({ method: "POST", url: "https://app.bystro.cz/obnova-hesla" });
    expect(JSON.stringify(event)).not.toMatch(/session-secret|hunter2|reset-token|example\.cz/);
  });

  it("reduces the user to their id", () => {
    const event = scrubSentryEvent({
      user: { id: "user-1", email: EMAIL, username: "Jan Novák", ip_address: "203.0.113.7" },
    });
    expect(event.user).toEqual({ id: "user-1" });

    expect(scrubSentryEvent({ user: { email: EMAIL } }).user).toEqual({});
  });

  it("scrubs messages and exception values", () => {
    const event = scrubSentryEvent({
      message: `Reminder to ${EMAIL} failed`,
      exception: {
        values: [{ value: `Payment of 112 000 Kč from CZ6508000000192000145399 not matched` }],
      },
    });

    expect(event.message).toBe("Reminder to [redacted] failed");
    expect(event.exception?.values?.[0]?.value).toBe(
      "Payment of [redacted] from [redacted] not matched",
    );
  });

  it("scrubs breadcrumbs, extra data, contexts and tags", () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        { message: `fetch for ${EMAIL}`, data: { url: "/api/x", accessToken: "abc", status: 200 } },
      ],
      extra: { invoice: { id: "FV-1", amountMinor: 11200000, note: `kontakt ${EMAIL}` } },
      contexts: { integration: { provider: "fio", apiToken: "fio-secret" } },
      tags: { organizationId: "org-1", userEmail: EMAIL },
      server_name: "DESKTOP-PETR",
    });

    const raw = JSON.stringify(event);
    expect(raw).not.toMatch(/example\.cz|fio-secret|11200000|DESKTOP-PETR/);
    expect(event.breadcrumbs?.[0]?.data).toEqual({
      url: "/api/x",
      accessToken: "[redacted]",
      status: 200,
    });
    expect(event.extra).toEqual({
      invoice: { id: "FV-1", amountMinor: "[redacted]", note: "kontakt [redacted]" },
    });
    expect(event.tags).toEqual({ organizationId: "org-1", userEmail: "[redacted]" });
    expect(event).not.toHaveProperty("server_name");
  });

  it("leaves an event without sensitive parts unchanged", () => {
    const event = { exception: { values: [{ value: "Cannot read properties of undefined" }] } };
    expect(scrubSentryEvent(structuredClone(event))).toEqual(event);
  });
});

describe("SENTRY_BASE_OPTIONS", () => {
  it("never sends default PII and does not trace", () => {
    expect(SENTRY_BASE_OPTIONS).toEqual({ sendDefaultPii: false, tracesSampleRate: 0 });
  });
});
