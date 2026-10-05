import { describe, expect, it } from "vitest";

import { createLogger } from "./logger";

/** Creates a logger that writes into memory and exposes what was written. */
function capture(level = "info") {
  const lines: string[] = [];
  const logger = createLogger({
    service: "test",
    level,
    destination: { write: (line: string) => void lines.push(line) },
  });
  return {
    logger,
    raw: () => lines.join(""),
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const SECRETS = {
  token: "ya29.super-secret-access-token",
  password: "hunter2-password",
  email: "jan.novak@example.cz",
  iban: "CZ6508000000192000145399",
  account: "19-2000145399/0800",
};

describe("createLogger", () => {
  it("writes structured JSON with service, level and time", () => {
    const { logger, entries } = capture();
    logger.info({ invoiceId: "FV-2026-0142", count: 8 }, "Invoices synced");

    const [entry] = entries();
    expect(entry).toMatchObject({
      level: "info",
      service: "test",
      invoiceId: "FV-2026-0142",
      count: 8,
      msg: "Invoices synced",
    });
    expect(typeof entry?.time).toBe("string");
    expect(entry).not.toHaveProperty("pid");
    expect(entry).not.toHaveProperty("hostname");
  });

  it("never writes the value of a redacted field", () => {
    const { logger, raw, entries } = capture();
    logger.info(
      {
        accessToken: SECRETS.token,
        refresh_token: SECRETS.token,
        password: SECRETS.password,
        email: SECRETS.email,
        iban: SECRETS.iban,
        authorization: `Bearer ${SECRETS.token}`,
        cookie: "session=abc123secret",
        amountMinor: 11200000,
        balance: 18640000,
      },
      "Connection saved",
    );

    for (const secret of [...Object.values(SECRETS), "abc123secret", "11200000", "18640000"]) {
      expect(raw()).not.toContain(secret);
    }
    expect(entries()[0]).toMatchObject({
      accessToken: "[redacted]",
      password: "[redacted]",
      email: "[redacted]",
      iban: "[redacted]",
      amountMinor: "[redacted]",
      msg: "Connection saved",
    });
  });

  it("redacts nested objects and arrays", () => {
    const { logger, raw } = capture();
    logger.warn({
      connection: { provider: "fio", credentials: { apiToken: SECRETS.token } },
      recipients: [{ name: "Novák", email: SECRETS.email }],
    });

    expect(raw()).not.toContain(SECRETS.token);
    expect(raw()).not.toContain(SECRETS.email);
    expect(raw()).toContain("fio");
  });

  it("scrubs e-mails, IBANs, account numbers and amounts from message text", () => {
    const { logger, raw, entries } = capture();
    logger.info(
      `Reminder to ${SECRETS.email} for 112 000 Kč, pay to ${SECRETS.iban} or ${SECRETS.account}`,
    );

    expect(raw()).not.toContain(SECRETS.email);
    expect(raw()).not.toContain(SECRETS.iban);
    expect(raw()).not.toContain(SECRETS.account);
    expect(raw()).not.toContain("112 000");
    expect(entries()[0]?.msg).toBe(
      "Reminder to [redacted] for [redacted], pay to [redacted] or [redacted]",
    );
  });

  it("scrubs sensitive text inside values stored under neutral keys", () => {
    const { logger, raw } = capture();
    logger.info({ note: `client ${SECRETS.email} owes 5 000 Kč` }, "Note saved");
    expect(raw()).not.toContain(SECRETS.email);
    expect(raw()).not.toContain("5 000");
  });

  it("logs errors without leaking secrets from their message or cause", () => {
    const { logger, raw, entries } = capture();
    const error = new Error(`Token ${SECRETS.token} rejected for ${SECRETS.email}`, {
      cause: new Error(`Bearer ${SECRETS.token}`),
    });

    logger.error({ err: error, token: SECRETS.token }, "Sync failed");
    logger.error(error);

    expect(raw()).not.toContain(SECRETS.email);
    expect(raw()).not.toContain(`Bearer ${SECRETS.token}`);
    const [first, second] = entries();
    expect(first?.err).toMatchObject({ type: "Error" });
    expect((first?.err as { stack: string }).stack).toContain("logger.test");
    expect(second?.err).toMatchObject({ type: "Error" });
  });

  it("redacts bindings of child loggers", () => {
    const { logger, raw, entries } = capture();
    const child = logger.child({ organizationId: "org-1", userEmail: SECRETS.email });
    child.info("Child message");

    expect(raw()).not.toContain(SECRETS.email);
    expect(entries()[0]).toMatchObject({ organizationId: "org-1", userEmail: "[redacted]" });

    const grandchild = child.child({ sessionToken: SECRETS.token });
    grandchild.info("Grandchild message");
    expect(raw()).not.toContain(SECRETS.token);
  });

  it("respects the log level", () => {
    const { logger, entries } = capture("warn");
    logger.info("hidden");
    logger.warn("shown");
    expect(entries().map((entry) => entry.msg)).toEqual(["shown"]);
  });

  it("falls back to info when LOG_LEVEL is empty or missing", () => {
    const previous = process.env.LOG_LEVEL;
    try {
      for (const value of ["", "  ", undefined]) {
        if (value === undefined) {
          delete process.env.LOG_LEVEL;
        } else {
          process.env.LOG_LEVEL = value;
        }
        const logger = createLogger({ service: "test", destination: { write: () => {} } });
        expect(logger.level).toBe("info");
      }
      process.env.LOG_LEVEL = "debug";
      expect(createLogger({ service: "test", destination: { write: () => {} } }).level).toBe(
        "debug",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = previous;
      }
    }
  });

  it("does not modify the object passed in", () => {
    const { logger } = capture();
    const payload = { password: SECRETS.password, nested: { email: SECRETS.email } };
    logger.info(payload, "Saved");
    expect(payload).toEqual({ password: SECRETS.password, nested: { email: SECRETS.email } });
  });
});
