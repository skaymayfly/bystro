import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  decideAction,
  listInvoiceReminders,
  proposeAction,
  updateProposedActionPreview,
} from "./actions";
import { createDb } from "./client";
import { setReminderSettings } from "./organizations";
import { forOrganization } from "./tenant";
import { createTestOrganization } from "./test/fixtures";
import { readTestDatabase } from "./test/test-database";

const { db, close } = createDb(readTestDatabase().url);

afterAll(async () => {
  await close();
});

const reminder = (invoiceId: string, userId: string) => ({
  type: "invoice_reminder" as const,
  triggerCode: "invoice_overdue",
  sources: [{ type: "invoice", id: invoiceId }],
  preview: { to: [{ name: null, address: "jana@novak.test" }], subject: "Připomínka" },
  approvalLevel: "user" as const,
  expiresAt: null,
  idempotencyKey: `invoice_reminder:${randomUUID()}`,
  proposedBy: { type: "user" as const, userId },
  source: "web" as const,
});

describe("reminders in the database", () => {
  it("finds the reminders of one invoice only, newest first, within the organization", async () => {
    const { organization, owner } = await createTestOrganization(db, "Upomínky A");
    const invoiceA = randomUUID();
    const first = await proposeAction(db, organization.id, reminder(invoiceA, owner.id));
    const second = await proposeAction(db, organization.id, reminder(invoiceA, owner.id));
    await proposeAction(db, organization.id, reminder(randomUUID(), owner.id));

    const found = await listInvoiceReminders(db, organization.id, invoiceA);
    expect(found.map((action) => action.id)).toEqual([second.action.id, first.action.id]);

    const other = await createTestOrganization(db, "Upomínky B");
    expect(await listInvoiceReminders(db, other.organization.id, invoiceA)).toEqual([]);
  });

  it("lets the preview change only while the action waits for a decision, and audits no text", async () => {
    const { organization, owner } = await createTestOrganization(db, "Upomínky náhled");
    const { action } = await proposeAction(db, organization.id, reminder(randomUUID(), owner.id));
    const who = { userId: owner.id, source: "web" as const };

    const edited = await updateProposedActionPreview(
      db,
      organization.id,
      action.id,
      { subject: "Tajný nový předmět" },
      who,
    );
    expect(edited?.preview).toEqual({ subject: "Tajný nový předmět" });

    await decideAction(db, organization.id, action.id, {
      userId: owner.id,
      decision: "rejected",
      source: "web",
    });
    expect(
      await updateProposedActionPreview(db, organization.id, action.id, { subject: "x" }, who),
    ).toBeNull();
    const audit = await forOrganization(db, organization.id).listAuditLogs();
    expect(audit.some((entry) => entry.action === "action.preview_edited")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("Tajný");
  });

  it("stores the company's reminder settings and refuses nonsense", async () => {
    const { organization, owner } = await createTestOrganization(db, "Upomínky nastavení");
    const who = { userId: owner.id, source: "web" as const };
    expect((await forOrganization(db, organization.id).getOrganization())?.reminderAfterDays).toBe(
      3,
    );

    await setReminderSettings(db, organization.id, { afterDays: 7, repeatDays: 14 }, who);
    const stored = await forOrganization(db, organization.id).getOrganization();
    expect(stored).toMatchObject({ reminderAfterDays: 7, reminderRepeatDays: 14 });

    await expect(
      setReminderSettings(db, organization.id, { afterDays: 0, repeatDays: 7 }, who),
    ).rejects.toThrow(RangeError);
  });
});
