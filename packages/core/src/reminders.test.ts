import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_SETTINGS,
  reminderSubject,
  reminderText,
  shouldProposeReminder,
} from "./reminders";

const NOW = new Date("2026-10-26T06:30:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe("shouldProposeReminder", () => {
  const candidate = { daysOverdue: 3, clientEmail: "jana@novak.test", lastReminderAt: null };

  it("proposes once the invoice is overdue long enough", () => {
    expect(shouldProposeReminder(candidate, DEFAULT_REMINDER_SETTINGS, NOW)).toBe(true);
    expect(
      shouldProposeReminder({ ...candidate, daysOverdue: 2 }, DEFAULT_REMINDER_SETTINGS, NOW),
    ).toBe(false);
  });

  it("needs an address to write to", () => {
    for (const clientEmail of [null, "  "]) {
      expect(
        shouldProposeReminder({ ...candidate, clientEmail }, DEFAULT_REMINDER_SETTINGS, NOW),
      ).toBe(false);
    }
  });

  it("waits the repeat period after the last reminder, to the hour", () => {
    expect(
      shouldProposeReminder(
        { ...candidate, lastReminderAt: daysAgo(6.9) },
        DEFAULT_REMINDER_SETTINGS,
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldProposeReminder(
        { ...candidate, lastReminderAt: daysAgo(7) },
        DEFAULT_REMINDER_SETTINGS,
        NOW,
      ),
    ).toBe(true);
  });

  it("follows the company's own settings", () => {
    const settings = { afterDays: 14, repeatDays: 3 };
    expect(shouldProposeReminder({ ...candidate, daysOverdue: 13 }, settings, NOW)).toBe(false);
    expect(
      shouldProposeReminder(
        { ...candidate, daysOverdue: 20, lastReminderAt: daysAgo(3) },
        settings,
        NOW,
      ),
    ).toBe(true);
  });
});

describe("reminder text", () => {
  const input = {
    invoiceNumber: "2026-0142",
    amount: "112 000 Kč",
    dueOn: "12. 10. 2026",
    senderName: "Petr Dvořák",
  };

  it("names the invoice, amount and due date in the formal tone and is signed", () => {
    const text = reminderText({ ...input, tone: "formal" });
    expect(text).toContain("fakturu 2026-0142 na 112 000 Kč, která byla splatná 12. 10. 2026");
    expect(text.startsWith("Dobrý den,\n\n")).toBe(true);
    expect(text.endsWith("\nPetr Dvořák")).toBe(true);
  });

  it("is lighter in the soft tone", () => {
    const text = reminderText({ ...input, tone: "soft" });
    expect(text).toContain("jen drobnost");
    expect(text).toContain("2026-0142 na 112 000 Kč");
    expect(text).not.toContain("splatná");
  });

  it("has a subject with the invoice number", () => {
    expect(reminderSubject("2026-0142")).toBe("Připomínka faktury 2026-0142");
  });
});
