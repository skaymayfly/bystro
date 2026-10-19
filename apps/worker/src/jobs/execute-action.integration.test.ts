import { randomBytes, randomUUID } from "node:crypto";

import { Secret, type ExecuteActionPayload, type Invoice } from "@bystro/core";
import {
  createDb,
  decideAction,
  forOrganization,
  getAction,
  listInvoices,
  proposeAction,
  saveConnection,
  upsertInvoices,
  type ProposeActionInput,
} from "@bystro/db";
import { createTestOrganization, loadRootEnv, readTestDatabase } from "@bystro/db/testing";
import { UnrecoverableError } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";

import { silentLogger } from "../test/redis";
import { executeActionHandler, type ActionExecutor, type ActionExecutors } from "./execute-action";

loadRootEnv();
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
  variableSymbol: null,
  kind: "invoice",
  direction: "issued",
  sourceStatus: "open",
  clientExternalId: null,
  issuedOn: "2026-09-20",
  dueOn: "2026-10-07",
  taxableSupplyOn: null,
  paidOn: null,
  currency: "CZK",
  subtotalMinor: 100_000n,
  vatMinor: 0n,
  totalMinor: 100_000n,
  lines: [],
  payments: [],
  ...overrides,
});

/** An approved reminder about an overdue invoice. */
async function approvedReminder(overrides: Partial<ProposeActionInput> = {}) {
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
    preview: {},
    approvalLevel: "user",
    expiresAt: new Date("2026-10-26T08:00:00Z"),
    idempotencyKey: `reminder:${randomUUID()}`,
    proposedBy: { type: "system" },
    source: "worker",
    ...overrides,
  });
  await decideAction(db, organization.id, action.id, {
    userId: owner.id,
    decision: "approved",
    source: "web",
    now: NOW,
  });
  const data: ExecuteActionPayload = { organizationId: organization.id, actionId: action.id };
  return { data, scope, organizationId: organization.id, actionId: action.id };
}

function run(data: ExecuteActionPayload, executors: ActionExecutors, now = NOW) {
  const handler = executeActionHandler({ db, executors, now: () => now });
  return handler({ data, jobId: "job-1", attempt: 1, logger: silentLogger });
}

/** An executor that counts its calls and answers with a message id. */
function countingExecutor(): ActionExecutor & { calls: number } {
  const executor = Object.assign(
    async () => {
      executor.calls += 1;
      // Give a concurrent run the chance to interleave.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { resultReference: `message-${executor.calls}` };
    },
    { calls: 0 },
  );
  return executor;
}

describe("executeActionHandler", () => {
  it("carries out an approved action and records the result", async () => {
    const { data, organizationId, actionId } = await approvedReminder();
    const executor = countingExecutor();

    await run(data, { invoice_reminder: executor });

    expect(executor.calls).toBe(1);
    expect(await getAction(db, organizationId, actionId)).toMatchObject({
      status: "succeeded",
      resultReference: "message-1",
      executedAt: NOW,
    });
    const changes = (await forOrganization(db, organizationId).listAuditLogs())
      .filter((entry) => entry.action === "action.status_changed")
      .map((entry) => entry.metadata.to)
      .reverse();
    expect(changes).toEqual(["approved", "executing", "succeeded"]);
  });

  it("two jobs for the same action carry it out once", async () => {
    const { data, organizationId, actionId } = await approvedReminder();
    const executor = countingExecutor();

    await Promise.all([
      run(data, { invoice_reminder: executor }),
      run(data, { invoice_reminder: executor }),
    ]);
    // And once more, later.
    await run(data, { invoice_reminder: executor });

    expect(executor.calls).toBe(1);
    expect((await getAction(db, organizationId, actionId))?.status).toBe("succeeded");
  });

  it("does not remind about an invoice that got paid after the approval", async () => {
    const { data, scope, organizationId, actionId } = await approvedReminder();
    await upsertInvoices(db, scope, [invoice({ sourceStatus: "paid", paidOn: "2026-10-19" })]);
    const executor = countingExecutor();

    await run(data, { invoice_reminder: executor });

    expect(executor.calls).toBe(0);
    expect((await getAction(db, organizationId, actionId))?.status).toBe("expired");
    const [entry] = await forOrganization(db, organizationId).listAuditLogs();
    expect(entry?.metadata).toMatchObject({ event: "expire", reason: "source_changed" });
  });

  it("does not carry out an action past its validity", async () => {
    const { data, organizationId, actionId } = await approvedReminder({
      expiresAt: new Date("2026-10-19T09:00:00Z"),
    });
    const executor = countingExecutor();

    await run(data, { invoice_reminder: executor }, new Date("2026-10-19T10:00:00Z"));

    expect(executor.calls).toBe(0);
    expect((await getAction(db, organizationId, actionId))?.status).toBe("expired");
  });

  it("records a failure of the executor with a code, without retrying", async () => {
    const { data, organizationId, actionId } = await approvedReminder();
    let calls = 0;
    const failing: ActionExecutor = async () => {
      calls += 1;
      throw Object.assign(new Error("SMTP said 550 for fakturace@novak.example"), {
        code: "provider_unavailable",
      });
    };

    await run(data, { invoice_reminder: failing });
    await run(data, { invoice_reminder: failing });

    expect(calls).toBe(1);
    const stored = await getAction(db, organizationId, actionId);
    expect(stored).toMatchObject({ status: "failed", errorCode: "provider_unavailable" });
    const [entry] = await forOrganization(db, organizationId).listAuditLogs();
    expect(JSON.stringify(entry?.metadata)).not.toContain("novak");
  });

  it("keeps a failure without a usable code as a generic one", async () => {
    const { data, organizationId, actionId } = await approvedReminder();

    await run(data, {
      invoice_reminder: async () => {
        throw new TypeError("Cannot read properties of undefined");
      },
    });

    expect((await getAction(db, organizationId, actionId))?.errorCode).toBe("executor_error");
  });

  it("fails an action nothing can carry out yet, and sends nothing", async () => {
    const { data, organizationId, actionId } = await approvedReminder();

    await run(data, {});

    expect(await getAction(db, organizationId, actionId)).toMatchObject({
      status: "failed",
      errorCode: "no_executor",
    });
  });

  it("leaves alone an action that is not approved, and gives up on an unknown one", async () => {
    const { data, organizationId } = await approvedReminder();
    const { action } = await proposeAction(db, organizationId, {
      type: "invoice_reminder",
      triggerCode: "invoice_overdue",
      sources: [],
      preview: {},
      approvalLevel: "user",
      expiresAt: null,
      idempotencyKey: "still-proposed",
      proposedBy: { type: "system" },
      source: "worker",
    });
    const executor = countingExecutor();

    await run({ organizationId, actionId: action.id }, { invoice_reminder: executor });
    expect(executor.calls).toBe(0);
    expect((await getAction(db, organizationId, action.id))?.status).toBe("proposed");

    await expect(
      run({ ...data, actionId: randomUUID() }, { invoice_reminder: executor }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
