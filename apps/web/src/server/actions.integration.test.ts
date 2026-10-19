import { randomBytes, randomUUID } from "node:crypto";

import { Secret, type ExecuteActionPayload, type Invoice } from "@bystro/core";
import {
  createDb,
  getAction,
  getApproval,
  listInvoices,
  markInvoicesDeleted,
  proposeAction,
  saveConnection,
  upsertInvoices,
  type ProposeActionInput,
} from "@bystro/db";
import { createTestOrganization, readTestDatabase } from "@bystro/db/testing";
import { afterAll, describe, expect, it } from "vitest";

import { decideOnAction, type ActionDecisionDeps } from "./actions";

const { db, close } = createDb(readTestDatabase().url);

afterAll(async () => {
  await close();
});

const NOW = new Date("2026-10-19T08:00:00Z");

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  source: "fakturoid",
  externalId: "1",
  sourceUpdatedAt: null,
  number: "2026-01",
  variableSymbol: "202601",
  kind: "invoice",
  direction: "issued",
  sourceStatus: "open",
  clientExternalId: null,
  issuedOn: "2026-09-20",
  taxableSupplyOn: null,
  // Twelve days overdue on NOW.
  dueOn: "2026-10-07",
  paidOn: null,
  currency: "CZK",
  subtotalMinor: 100_000n,
  vatMinor: 21_000n,
  totalMinor: 121_000n,
  lines: [],
  payments: [],
  ...overrides,
});

/** A company with an overdue invoice and a proposed reminder about it. */
async function companyWithReminder(overrides: Partial<ProposeActionInput> = {}) {
  const { organization, owner } = await createTestOrganization(db, "Firma A");
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: "fakturoid",
      category: "invoicing",
      externalAccountId: "ucet",
      scopes: [],
      tokens: { accessToken: new Secret("token"), refreshToken: null, expiresAt: null },
      userId: owner.id,
      source: "web",
    },
    randomBytes(32),
  );
  const scope = { organizationId: organization.id, connectionId: connection.id };
  await upsertInvoices(db, scope, [invoice()]);
  const [stored] = await listInvoices(db, organization.id);
  const { action } = await proposeAction(db, organization.id, {
    type: "invoice_reminder",
    triggerCode: "invoice_overdue",
    sources: [{ type: "invoice", id: stored?.id ?? "" }],
    preview: { subject: "Upomínka" },
    approvalLevel: "user",
    expiresAt: new Date("2026-10-26T08:00:00Z"),
    idempotencyKey: `reminder:${randomUUID()}`,
    proposedBy: { type: "system" },
    source: "worker",
    ...overrides,
  });
  return { organizationId: organization.id, userId: owner.id, actionId: action.id, scope };
}

function deps(): ActionDecisionDeps & {
  enqueued: { data: ExecuteActionPayload; jobId: string }[];
} {
  const enqueued: { data: ExecuteActionPayload; jobId: string }[] = [];
  return {
    db,
    now: NOW,
    enqueued,
    enqueue: async (data, jobId) => {
      enqueued.push({ data, jobId });
      return true;
    },
  };
}

type Who = Awaited<ReturnType<typeof companyWithReminder>>;
const approve = (
  d: ActionDecisionDeps,
  who: Who,
  role: "owner" | "admin" | "member" | null = "owner",
) =>
  decideOnAction(d, {
    organizationId: who.organizationId,
    userId: who.userId,
    role,
    actionId: who.actionId,
    decision: "approved",
  });
const reject = (d: ActionDecisionDeps, who: Who) =>
  decideOnAction(d, {
    organizationId: who.organizationId,
    userId: who.userId,
    role: "owner",
    actionId: who.actionId,
    decision: "rejected",
  });

describe("decideOnAction", () => {
  it("approves and hands the action to the worker", async () => {
    const who = await companyWithReminder();
    const d = deps();

    const result = await approve(d, who);

    expect(result).toEqual({
      ok: true,
      view: { actionId: who.actionId, status: "approved", executedAt: null, resultReference: null },
    });
    expect(d.enqueued).toEqual([
      {
        data: { organizationId: who.organizationId, actionId: who.actionId },
        jobId: `actions.execute.${who.actionId}`,
      },
    ]);
    expect(await getApproval(db, who.organizationId, who.actionId)).toMatchObject({
      userId: who.userId,
      decision: "approved",
    });
  });

  it("a double click is answered the same way and enqueues the same job", async () => {
    const who = await companyWithReminder();
    const d = deps();

    const first = await approve(d, who);
    const second = await approve(d, who);

    expect(second).toEqual(first);
    expect(new Set(d.enqueued.map((item) => item.jobId)).size).toBe(1);
  });

  it("three approvals at once lead to one decision", async () => {
    const who = await companyWithReminder();
    const d = deps();

    const results = await Promise.all([approve(d, who), approve(d, who), approve(d, who)]);

    expect(results.every((result) => result.ok && result.view.status === "approved")).toBe(true);
    expect(new Set(d.enqueued.map((item) => item.jobId)).size).toBe(1);
    expect((await getAction(db, who.organizationId, who.actionId))?.status).toBe("approved");
  });

  it("refuses the opposite decision once one was made", async () => {
    const who = await companyWithReminder();
    const d = deps();
    await reject(d, who);

    expect(await approve(d, who)).toEqual({ ok: false, error: "conflict" });
    expect(d.enqueued).toEqual([]);
    expect((await getAction(db, who.organizationId, who.actionId))?.status).toBe("rejected");
  });

  it("rejecting enqueues nothing", async () => {
    const who = await companyWithReminder();
    const d = deps();

    const result = await reject(d, who);

    expect(result).toMatchObject({ ok: true, view: { status: "rejected" } });
    expect(d.enqueued).toEqual([]);
  });

  it("only the owner and an admin may decide", async () => {
    const who = await companyWithReminder();
    const d = deps();

    expect(await approve(d, who, "member")).toEqual({ ok: false, error: "forbidden" });
    expect(await approve(d, who, null)).toEqual({ ok: false, error: "forbidden" });
    expect((await getAction(db, who.organizationId, who.actionId))?.status).toBe("proposed");

    expect(await approve(d, who, "admin")).toMatchObject({ ok: true });
  });

  it("an action of another company is not found", async () => {
    const mine = await companyWithReminder();
    const theirs = await companyWithReminder();
    const d = deps();

    const result = await decideOnAction(d, {
      organizationId: mine.organizationId,
      userId: mine.userId,
      role: "owner",
      actionId: theirs.actionId,
      decision: "approved",
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect((await getAction(db, theirs.organizationId, theirs.actionId))?.status).toBe("proposed");
  });

  it("calls off a reminder for an invoice that got paid in the meantime", async () => {
    const who = await companyWithReminder();
    await upsertInvoices(db, who.scope, [invoice({ sourceStatus: "paid", paidOn: "2026-10-18" })]);
    const d = deps();

    expect(await approve(d, who)).toEqual({ ok: false, error: "source_changed" });

    expect((await getAction(db, who.organizationId, who.actionId))?.status).toBe("expired");
    expect(await getApproval(db, who.organizationId, who.actionId)).toBeNull();
    expect(d.enqueued).toEqual([]);
    // Asking again says the same, without doing anything.
    expect(await approve(d, who)).toEqual({ ok: false, error: "expired" });
  });

  it("calls off a reminder for an invoice deleted at the source", async () => {
    const who = await companyWithReminder();
    await markInvoicesDeleted(db, who.organizationId, "fakturoid", ["1"]);

    expect(await approve(deps(), who)).toEqual({ ok: false, error: "source_changed" });
  });

  it("calls off a reminder when the due date moved and it is not overdue any more", async () => {
    const who = await companyWithReminder();
    await upsertInvoices(db, who.scope, [invoice({ dueOn: "2026-10-30" })]);

    expect(await approve(deps(), who)).toEqual({ ok: false, error: "source_changed" });
  });

  it("an expired action cannot be approved", async () => {
    const who = await companyWithReminder({ expiresAt: new Date("2026-10-19T07:00:00Z") });
    const d = deps();

    expect(await approve(d, who)).toEqual({ ok: false, error: "expired" });
    expect((await getAction(db, who.organizationId, who.actionId))?.status).toBe("expired");
    expect(d.enqueued).toEqual([]);
  });

  it("enqueues again when the first time the queue was down", async () => {
    const who = await companyWithReminder();
    const failing: ActionDecisionDeps = {
      db,
      now: NOW,
      enqueue: async () => {
        throw new Error("Redis unreachable");
      },
    };
    await expect(approve(failing, who)).rejects.toThrow("Redis unreachable");
    // The approval itself stands.
    expect((await getAction(db, who.organizationId, who.actionId))?.status).toBe("approved");

    const d = deps();
    expect(await approve(d, who)).toMatchObject({ ok: true, view: { status: "approved" } });
    expect(d.enqueued).toHaveLength(1);
  });
});
