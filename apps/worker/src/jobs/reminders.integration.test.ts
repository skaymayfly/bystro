import { randomBytes } from "node:crypto";

import { Secret, todayInPrague, type Client, type DateOnly, type Invoice } from "@bystro/core";
import {
  createDb,
  decideAction,
  encrypt,
  getAction,
  listActions,
  listInvoices,
  saveConnection,
  updateProposedActionPreview,
  upsertCompanies,
  upsertInvoices,
} from "@bystro/db";
import { createTestOrganization, loadRootEnv, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import { silentLogger } from "../test/redis";
import { executeActionHandler } from "./execute-action";
import { proposeRemindersHandler } from "./reminders";
import { createInvoiceReminderExecutor } from "./send-mail";

loadRootEnv();
const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);
const GMAIL = { clientId: "client-id", clientSecret: new Secret("client-secret") };

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

const client = (externalId: string, email: string | null): Client => ({
  source: "fakturoid",
  externalId,
  sourceUpdatedAt: null,
  name: `Klient ${externalId}`,
  ico: null,
  dic: null,
  street: null,
  city: null,
  postalCode: null,
  country: "CZ",
  email,
  phone: null,
});

const invoice = (number: string, clientExternalId: string, dueOn: DateOnly): Invoice => ({
  source: "fakturoid",
  externalId: number,
  sourceUpdatedAt: null,
  number,
  variableSymbol: null,
  kind: "invoice",
  direction: "issued",
  sourceStatus: "open",
  clientExternalId,
  issuedOn: day(-40),
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

/** A company with Fakturoid, optionally Gmail, and three overdue-ish invoices. */
async function company(options: { gmail: boolean }) {
  const { organization, owner } = await createTestOrganization(db, "Firma s fakturami");
  const tokens = { accessToken: new Secret("t"), refreshToken: null, expiresAt: null };
  const invoicing = await saveConnection(
    db,
    organization.id,
    {
      provider: "fakturoid",
      category: "invoicing",
      externalAccountId: "ucet",
      scopes: [],
      tokens,
      userId: owner.id,
      source: "web",
    },
    key,
  );
  if (options.gmail) {
    await saveConnection(
      db,
      organization.id,
      {
        provider: "gmail",
        category: "email",
        externalAccountId: "petr@dvorak.test",
        scopes: [],
        tokens,
        userId: owner.id,
        source: "web",
      },
      key,
    );
  }
  const scope = { organizationId: organization.id, connectionId: invoicing.id };
  await upsertCompanies(db, scope, [client("novak", "jana@novak.test"), client("bez", null)]);
  await upsertInvoices(db, scope, [
    invoice("2026-0142", "novak", day(-5)),
    invoice("2026-0150", "novak", day(-1)),
    invoice("2026-0155", "bez", day(-10)),
  ]);
  const ids = Object.fromEntries(
    (await listInvoices(db, organization.id)).map((item) => [item.number, item.id]),
  );
  return { organizationId: organization.id, ownerId: owner.id, ids };
}

const propose = (organizationId: string) =>
  proposeRemindersHandler({ db, listOrganizations: async () => [organizationId] })({
    data: {},
    jobId: "p",
    attempt: 1,
    logger: silentLogger,
  });

const reminders = async (organizationId: string) =>
  (await listActions(db, organizationId)).filter((action) => action.type === "invoice_reminder");

describe("proposeRemindersHandler", () => {
  it("proposes once for an invoice overdue long enough with a client e-mail", async () => {
    const { organizationId, ids } = await company({ gmail: true });
    await propose(organizationId);
    await propose(organizationId);

    const proposed = await reminders(organizationId);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      status: "proposed",
      triggerCode: "invoice_overdue",
      sources: [{ type: "invoice", id: ids["2026-0142"] }],
      preview: {
        to: [{ name: "Klient novak", address: "jana@novak.test" }],
        subject: "Připomínka faktury 2026-0142",
        bodyEncrypted: null,
        attachPdf: true,
      },
    });
  });

  it("proposes nothing without a connected Gmail", async () => {
    const { organizationId } = await company({ gmail: false });
    await propose(organizationId);
    expect(await reminders(organizationId)).toEqual([]);
  });
});

function fakeGmail() {
  const sent: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages/send")) {
      sent.push(
        Buffer.from((JSON.parse(String(init?.body)) as { raw: string }).raw, "base64url").toString(
          "utf8",
        ),
      );
      return Response.json({ id: `sent-${sent.length}`, threadId: "t" });
    }
    return Response.json({ resultSizeEstimate: 0 });
  }) as typeof fetch;
  return { sent, fetchFn };
}

/** The proposal, edited and approved as the user does on the invoice. */
async function approvedReminder(attachPdf: boolean) {
  const created = await company({ gmail: true });
  await propose(created.organizationId);
  const [action] = await reminders(created.organizationId);
  const id = action?.id ?? "";
  await updateProposedActionPreview(
    db,
    created.organizationId,
    id,
    {
      to: [{ name: "Jana Nová", address: "jana@novak.test" }],
      subject: "Připomínka faktury 2026-0142",
      bodyEncrypted: encrypt("Dobrý den, připomínám fakturu.", key),
      attachPdf,
    },
    { userId: created.ownerId, source: "web" },
  );
  await decideAction(db, created.organizationId, id, {
    userId: created.ownerId,
    decision: "approved",
    source: "web",
  });
  return { ...created, actionId: id };
}

const execute = (
  organizationId: string,
  actionId: string,
  gmail: ReturnType<typeof fakeGmail>,
  fetchDocument: () => Promise<{
    fileName: string;
    contentType: string;
    content: Uint8Array;
  } | null>,
) =>
  executeActionHandler({
    db,
    executors: {
      invoice_reminder: createInvoiceReminderExecutor({
        db,
        encryptionKey: key,
        gmail: GMAIL,
        fetch: gmail.fetchFn,
        fetchDocument,
      }),
    },
  })({ data: { organizationId, actionId }, jobId: "e", attempt: 1, logger: silentLogger });

describe("sending a reminder", () => {
  it("sends the edited text with the invoice PDF attached", async () => {
    const { organizationId, actionId } = await approvedReminder(true);
    const gmail = fakeGmail();
    await execute(organizationId, actionId, gmail, async () => ({
      fileName: "faktura-2026-0142.pdf",
      contentType: "application/pdf",
      content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }));

    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0]).toMatch(/^To: .*<jana@novak\.test>$/m);
    expect(gmail.sent[0]).toContain('filename="faktura-2026-0142.pdf"');
    expect(await getAction(db, organizationId, actionId)).toMatchObject({
      status: "succeeded",
      resultReference: "sent-1",
    });
  });

  it("still sends the reminder when the PDF is not available", async () => {
    const { organizationId, actionId } = await approvedReminder(true);
    const gmail = fakeGmail();
    await execute(organizationId, actionId, gmail, async () => {
      throw new Error("invoicing system down");
    });
    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0]).not.toContain("multipart/mixed");
    expect((await getAction(db, organizationId, actionId))?.status).toBe("succeeded");
  });

  it("does not remind an invoice that got paid in the meantime", async () => {
    const { organizationId, actionId, ids } = await approvedReminder(false);
    const [stored] = (await listInvoices(db, organizationId)).filter(
      (item) => item.id === ids["2026-0142"],
    );
    await upsertInvoices(db, { organizationId, connectionId: stored?.connectionId ?? "" }, [
      { ...invoice("2026-0142", "novak", day(-5)), sourceStatus: "paid", paidOn: day(-1) },
    ]);
    const gmail = fakeGmail();
    await execute(organizationId, actionId, gmail, async () => null);
    expect(gmail.sent).toEqual([]);
    expect((await getAction(db, organizationId, actionId))?.status).toBe("expired");
  });
});
