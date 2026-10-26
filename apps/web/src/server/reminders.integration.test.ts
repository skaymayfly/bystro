import { randomBytes } from "node:crypto";

import { Secret, todayInPrague, type DateOnly, type Invoice } from "@bystro/core";
import {
  createDb,
  forOrganization,
  listActions,
  listInvoices,
  proposeAction,
  saveConnection,
  upsertCompanies,
  upsertInvoices,
} from "@bystro/db";
import { createTestOrganization, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import { handleReminder, loadRemindedOn, type ReminderRequest } from "./reminders";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);

afterAll(async () => {
  await close();
});

function day(offset: number): DateOnly {
  const [year, month, date] = todayInPrague(new Date()).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10) as DateOnly;
}

const invoice = (number: string, dueOn: DateOnly): Invoice => ({
  source: "fakturoid",
  externalId: number,
  sourceUpdatedAt: null,
  number,
  variableSymbol: null,
  kind: "invoice",
  direction: "issued",
  sourceStatus: "open",
  clientExternalId: "novak",
  issuedOn: day(-30),
  taxableSupplyOn: null,
  dueOn,
  paidOn: null,
  currency: "CZK",
  subtotalMinor: 0n,
  vatMinor: 0n,
  totalMinor: 1_120_000n,
  lines: [],
  payments: [],
});

async function company(options: { gmail: boolean } = { gmail: true }) {
  const { organization, owner } = await createTestOrganization(db, "Firma upomíná");
  const tokens = { accessToken: new Secret("t"), refreshToken: null, expiresAt: null };
  const save = (provider: string, category: "invoicing" | "email") =>
    saveConnection(
      db,
      organization.id,
      {
        provider,
        category,
        externalAccountId: provider === "gmail" ? "petr@dvorak.test" : "ucet",
        scopes: [],
        tokens,
        userId: owner.id,
        source: "web",
      },
      key,
    );
  const invoicing = await save("fakturoid", "invoicing");
  if (options.gmail) await save("gmail", "email");
  const scope = { organizationId: organization.id, connectionId: invoicing.id };
  await upsertCompanies(db, scope, [
    {
      source: "fakturoid",
      externalId: "novak",
      sourceUpdatedAt: null,
      name: "Novák s.r.o.",
      ico: null,
      dic: null,
      street: null,
      city: null,
      postalCode: null,
      country: "CZ",
      email: "jana@novak.test",
      phone: null,
    },
  ]);
  await upsertInvoices(db, scope, [invoice("2026-0142", day(-5)), invoice("2026-0160", day(5))]);
  const ids = Object.fromEntries(
    (await listInvoices(db, organization.id)).map((item) => [item.number, item.id]),
  );
  return {
    who: { organizationId: organization.id, userId: owner.id, role: "owner" as const },
    ids,
  };
}

const send = (overrides: Partial<Extract<ReminderRequest, { decision: "send" }>> = {}) =>
  ({
    decision: "send",
    to: "Jana Nová <jana@novak.test>",
    subject: "Připomínka faktury 2026-0142",
    body: "Dobrý den, tajně připomínám fakturu.",
    attachPdf: true,
    ...overrides,
  }) as const;

function recorder() {
  const jobs: string[] = [];
  return {
    jobs,
    deps: {
      db,
      encryptionKey: key,
      enqueue: async (_data: unknown, jobId: string) => {
        jobs.push(jobId);
        return true;
      },
    },
  };
}

const reminders = async (organizationId: string) =>
  (await listActions(db, organizationId)).filter((action) => action.type === "invoice_reminder");

describe("handleReminder", () => {
  it("sends a reminder the user asked for: one approved action with the text encrypted", async () => {
    const { who, ids } = await company();
    const { deps, jobs } = recorder();

    const first = await handleReminder(deps, who, ids["2026-0142"] ?? "", send());
    const again = await handleReminder(deps, who, ids["2026-0142"] ?? "", send());

    expect(first).toMatchObject({ ok: true, status: "approved" });
    expect(again).toMatchObject({ ok: true, actionId: first.ok ? first.actionId : "" });
    const all = await reminders(who.organizationId);
    expect(all).toHaveLength(1);
    expect(all[0]?.preview).toMatchObject({
      to: [{ name: "Jana Nová", address: "jana@novak.test" }],
      subject: "Připomínka faktury 2026-0142",
      attachPdf: true,
    });
    expect(JSON.stringify(all[0]?.preview)).not.toContain("tajně");
    expect(new Set(jobs).size).toBe(1);
    const audit = await forOrganization(db, who.organizationId).listAuditLogs();
    expect(JSON.stringify(audit)).not.toMatch(/tajně|jana@novak/);
  });

  it("sends Bystro's proposal with the user's edits, or turns it down", async () => {
    const { who, ids } = await company();
    const propose = () =>
      proposeAction(db, who.organizationId, {
        type: "invoice_reminder",
        triggerCode: "invoice_overdue",
        sources: [{ type: "invoice", id: ids["2026-0142"] ?? "" }],
        preview: {
          to: [{ name: "Novák s.r.o.", address: "jana@novak.test" }],
          subject: "Připomínka faktury 2026-0142",
          bodyEncrypted: null,
          attachPdf: true,
        },
        approvalLevel: "user",
        expiresAt: null,
        idempotencyKey: `invoice_reminder:${ids["2026-0142"]}:test`,
        proposedBy: { type: "system" },
        source: "worker",
      });
    const { action } = await propose();
    const { deps } = recorder();

    expect(
      await handleReminder(deps, who, ids["2026-0142"] ?? "", { decision: "dismiss" }),
    ).toEqual({ ok: true, actionId: action.id, status: "rejected" });
    expect(await reminders(who.organizationId)).toHaveLength(1);
  });

  it("refuses an invoice not overdue, a company without Gmail and a member", async () => {
    const { who, ids } = await company();
    const { deps } = recorder();
    expect(await handleReminder(deps, who, ids["2026-0160"] ?? "", send())).toEqual({
      ok: false,
      error: "not_overdue",
    });
    expect(
      await handleReminder(deps, { ...who, role: "member" }, ids["2026-0142"] ?? "", send()),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await handleReminder(deps, who, ids["2026-0142"] ?? "", send({ to: "nesmysl" })),
    ).toEqual({ ok: false, error: "invalid" });

    const withoutMail = await company({ gmail: false });
    expect(
      await handleReminder(deps, withoutMail.who, withoutMail.ids["2026-0142"] ?? "", send()),
    ).toEqual({ ok: false, error: "no_mailbox" });
  });

  it("knows when each invoice was last reminded", async () => {
    const { who } = await company();
    expect((await loadRemindedOn(db, who.organizationId)).size).toBe(0);
  });
});
