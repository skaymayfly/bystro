import { ActionTransitionError, type ActionEvent } from "@bystro/core";
import { afterAll, describe, expect, it } from "vitest";

import {
  ActionExpiredError,
  ActionNotFoundError,
  applyActionEvent,
  ApprovalRequiredError,
  decideAction,
  getAction,
  getApproval,
  listActions,
  proposeAction,
  type ProposeActionInput,
} from "./actions";
import { createDb } from "./client";
import { forOrganization } from "./tenant";
import { createTestOrganization, createTestUser } from "./test/fixtures";
import { readTestDatabase } from "./test/test-database";

const { db, close } = createDb(readTestDatabase().url);

afterAll(async () => {
  await close();
});

const NOW = new Date("2026-10-19T08:00:00Z");
const system = { actor: { type: "system" as const }, source: "worker" as const };

function proposal(overrides: Partial<ProposeActionInput> = {}): ProposeActionInput {
  return {
    type: "invoice_reminder",
    triggerCode: "invoice_overdue",
    triggerData: { daysOverdue: 12 },
    sources: [{ type: "invoice", id: "0b0e8a52-5f0c-4d6e-9d57-0e6f0a5f3c11" }],
    preview: { recipient: "fakturace@novak.example", subject: "Upomínka faktury 2026-01" },
    approvalLevel: "user",
    expiresAt: new Date("2026-10-26T08:00:00Z"),
    idempotencyKey: "invoice_reminder:invoice-1:2026-10-19",
    proposedBy: { type: "system" },
    source: "worker",
    ...overrides,
  };
}

async function company(name = "Firma A") {
  const { organization, owner } = await createTestOrganization(db, name);
  return { organizationId: organization.id, userId: owner.id };
}

const auditOf = async (organizationId: string) =>
  forOrganization(db, organizationId).listAuditLogs({ limit: 50 });

describe("proposeAction", () => {
  it("stores a proposed action and audits it without the preview", async () => {
    const { organizationId } = await company();

    const { action, created } = await proposeAction(db, organizationId, proposal());

    expect(created).toBe(true);
    expect(action).toMatchObject({
      organizationId,
      type: "invoice_reminder",
      status: "proposed",
      approvalLevel: "user",
      triggerCode: "invoice_overdue",
      triggerData: { daysOverdue: 12 },
      proposedByType: "system",
      resultReference: null,
      errorCode: null,
    });
    const [entry] = await auditOf(organizationId);
    expect(entry).toMatchObject({
      action: "action.proposed",
      targetType: "action",
      targetId: action.id,
      actorType: "system",
    });
    // The preview (recipient, text) never goes into the audit log.
    expect(JSON.stringify(entry?.metadata)).not.toMatch(/novak|Upomínka/);
  });

  it("proposing the same thing twice creates nothing new", async () => {
    const { organizationId } = await company();

    const first = await proposeAction(db, organizationId, proposal());
    const second = await proposeAction(db, organizationId, proposal({ preview: { other: true } }));
    const [third, fourth] = await Promise.all([
      proposeAction(db, organizationId, proposal()),
      proposeAction(db, organizationId, proposal()),
    ]);

    expect(second).toEqual({ action: first.action, created: false });
    expect(third?.action.id).toBe(first.action.id);
    expect(fourth?.action.id).toBe(first.action.id);
    expect(await listActions(db, organizationId)).toHaveLength(1);
    const proposals = (await auditOf(organizationId)).filter(
      (entry) => entry.action === "action.proposed",
    );
    expect(proposals).toHaveLength(1);
  });

  it("uses the same key independently in each organization", async () => {
    const a = await company("Firma A");
    const b = await company("Firma B");

    const first = await proposeAction(db, a.organizationId, proposal());
    const second = await proposeAction(db, b.organizationId, proposal());

    expect(second.created).toBe(true);
    expect(second.action.id).not.toBe(first.action.id);
  });

  it("refuses malformed input", async () => {
    const { organizationId, userId } = await company();

    for (const bad of [
      proposal({ idempotencyKey: "" }),
      proposal({ idempotencyKey: "x".repeat(201) }),
      proposal({ triggerCode: "Invoice Overdue!" }),
      proposal({ sources: [{ type: "invoice", id: " " }] }),
    ]) {
      await expect(proposeAction(db, organizationId, bad)).rejects.toThrow(RangeError);
    }
    // A user who proposes is recorded.
    const { action } = await proposeAction(
      db,
      organizationId,
      proposal({ idempotencyKey: "by-user", proposedBy: { type: "user", userId }, source: "web" }),
    );
    expect(action.proposedByUserId).toBe(userId);
    expect(await listActions(db, organizationId)).toHaveLength(1);
  });
});

describe("decideAction", () => {
  it("approval records who decided and moves the action on, with an audit record", async () => {
    const { organizationId, userId } = await company();
    const { action } = await proposeAction(db, organizationId, proposal());

    const approved = await decideAction(db, organizationId, action.id, {
      userId,
      decision: "approved",
      source: "web",
      now: NOW,
    });

    expect(approved.status).toBe("approved");
    expect(approved.statusChangedAt).toEqual(NOW);
    expect(await getApproval(db, organizationId, action.id)).toMatchObject({
      userId,
      decision: "approved",
      createdAt: NOW,
    });
    const [entry] = await auditOf(organizationId);
    expect(entry).toMatchObject({
      action: "action.status_changed",
      actorType: "user",
      actorUserId: userId,
      targetId: action.id,
      metadata: { event: "approve", from: "proposed", to: "approved", decision: "approved" },
    });
  });

  it("rejection ends the action", async () => {
    const { organizationId, userId } = await company();
    const { action } = await proposeAction(db, organizationId, proposal());

    const rejected = await decideAction(db, organizationId, action.id, {
      userId,
      decision: "rejected",
      source: "web",
    });

    expect(rejected.status).toBe("rejected");
    await expect(
      applyActionEvent(db, organizationId, action.id, "start", { ...system, now: NOW }),
    ).rejects.toThrow(ActionTransitionError);
  });

  it("two decisions at the same time lead to exactly one", async () => {
    const { organizationId, userId } = await company();
    const { action } = await proposeAction(db, organizationId, proposal());
    const decide = (decision: "approved" | "rejected") =>
      decideAction(db, organizationId, action.id, { userId, decision, source: "web", now: NOW });

    const results = await Promise.allSettled([
      decide("approved"),
      decide("approved"),
      decide("rejected"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ActionTransitionError);
      }
    }
    const stored = await getAction(db, organizationId, action.id);
    const approval = await getApproval(db, organizationId, action.id);
    expect(stored?.status).toBe(approval?.decision);
    const changes = (await auditOf(organizationId)).filter(
      (entry) => entry.action === "action.status_changed",
    );
    expect(changes).toHaveLength(1);
  });

  it("an expired action cannot be approved: it is marked expired instead", async () => {
    const { organizationId, userId } = await company();
    const { action } = await proposeAction(
      db,
      organizationId,
      proposal({ expiresAt: new Date("2026-10-19T08:00:00Z") }),
    );

    const attempt = decideAction(db, organizationId, action.id, {
      userId,
      decision: "approved",
      source: "web",
      now: NOW,
    });

    await expect(attempt).rejects.toBeInstanceOf(ActionExpiredError);
    expect((await getAction(db, organizationId, action.id))?.status).toBe("expired");
    expect(await getApproval(db, organizationId, action.id)).toBeNull();
    const [entry] = await auditOf(organizationId);
    expect(entry?.metadata).toMatchObject({ event: "expire", from: "proposed", to: "expired" });
  });

  it("a forbidden decision changes nothing and leaves no trace", async () => {
    const { organizationId, userId } = await company();
    const { action } = await proposeAction(db, organizationId, proposal());
    await decideAction(db, organizationId, action.id, {
      userId,
      decision: "rejected",
      source: "web",
    });
    const auditBefore = (await auditOf(organizationId)).length;

    await expect(
      decideAction(db, organizationId, action.id, { userId, decision: "approved", source: "web" }),
    ).rejects.toThrow(ActionTransitionError);

    expect((await getAction(db, organizationId, action.id))?.status).toBe("rejected");
    expect((await getApproval(db, organizationId, action.id))?.decision).toBe("rejected");
    expect(await auditOf(organizationId)).toHaveLength(auditBefore);
  });
});

describe("applyActionEvent", () => {
  async function approvedAction(overrides: Partial<ProposeActionInput> = {}) {
    const who = await company();
    const { action } = await proposeAction(db, who.organizationId, proposal(overrides));
    await decideAction(db, who.organizationId, action.id, {
      userId: who.userId,
      decision: "approved",
      source: "web",
      now: NOW,
    });
    return { ...who, actionId: action.id };
  }

  it("carries an action through to verified, auditing every step", async () => {
    const { organizationId, actionId } = await approvedAction();
    const step = (event: Exclude<ActionEvent, "reject">, extra = {}) =>
      applyActionEvent(db, organizationId, actionId, event, { ...system, now: NOW, ...extra });

    expect((await step("start")).status).toBe("executing");
    const succeeded = await step("succeed", { resultReference: "message-123" });
    expect(succeeded).toMatchObject({ status: "succeeded", resultReference: "message-123" });
    expect((await step("verify")).status).toBe("verified");

    const changes = (await auditOf(organizationId))
      .filter((entry) => entry.action === "action.status_changed")
      .map((entry) => `${String(entry.metadata.from)}→${String(entry.metadata.to)}`)
      .reverse();
    expect(changes).toEqual([
      "proposed→approved",
      "approved→executing",
      "executing→succeeded",
      "succeeded→verified",
    ]);
  });

  it("records a failure with its code and ends there", async () => {
    const { organizationId, actionId } = await approvedAction();
    await applyActionEvent(db, organizationId, actionId, "start", { ...system, now: NOW });

    const failed = await applyActionEvent(db, organizationId, actionId, "fail", {
      ...system,
      now: NOW,
      errorCode: "provider_unavailable",
    });

    expect(failed).toMatchObject({ status: "failed", errorCode: "provider_unavailable" });
    const [entry] = await auditOf(organizationId);
    expect(entry).toMatchObject({
      result: "failure",
      metadata: { event: "fail", errorCode: "provider_unavailable" },
    });
    await expect(
      applyActionEvent(db, organizationId, actionId, "verify", { ...system, now: NOW }),
    ).rejects.toThrow(ActionTransitionError);
    // An error code is a code, never a provider's message.
    await expect(
      applyActionEvent(db, organizationId, (await approvedAction()).actionId, "fail", {
        ...system,
        errorCode: "Connection refused: smtp.example 10.0.0.1",
      }),
    ).rejects.toThrow();
  });

  it("does not start an action past its validity", async () => {
    const { organizationId, actionId } = await approvedAction({
      expiresAt: new Date("2026-10-19T09:00:00Z"),
    });

    await expect(
      applyActionEvent(db, organizationId, actionId, "start", {
        ...system,
        now: new Date("2026-10-19T09:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(ActionExpiredError);
    expect((await getAction(db, organizationId, actionId))?.status).toBe("expired");
  });

  it("an approved action can still be called off before it starts", async () => {
    const { organizationId, actionId } = await approvedAction();

    const expired = await applyActionEvent(db, organizationId, actionId, "expire", {
      ...system,
      now: NOW,
    });

    expect(expired.status).toBe("expired");
  });

  it("lets the system approve only what needs nobody's decision", async () => {
    const { organizationId } = await company();
    const needsUser = await proposeAction(db, organizationId, proposal());
    const automatic = await proposeAction(
      db,
      organizationId,
      proposal({ idempotencyKey: "automatic", approvalLevel: "none" }),
    );

    await expect(
      applyActionEvent(db, organizationId, needsUser.action.id, "approve", { ...system, now: NOW }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect((await getAction(db, organizationId, needsUser.action.id))?.status).toBe("proposed");

    const approved = await applyActionEvent(db, organizationId, automatic.action.id, "approve", {
      ...system,
      now: NOW,
    });
    expect(approved.status).toBe("approved");
  });
});

describe("organizations are kept apart", () => {
  it("an action of another organization cannot be read, decided or moved", async () => {
    const mine = await company("Firma A");
    const theirs = await company("Firma B");
    const { action } = await proposeAction(db, theirs.organizationId, proposal());

    expect(await getAction(db, mine.organizationId, action.id)).toBeNull();
    expect(await listActions(db, mine.organizationId)).toEqual([]);
    await expect(
      decideAction(db, mine.organizationId, action.id, {
        userId: mine.userId,
        decision: "approved",
        source: "web",
      }),
    ).rejects.toBeInstanceOf(ActionNotFoundError);
    await expect(
      applyActionEvent(db, mine.organizationId, action.id, "expire", system),
    ).rejects.toBeInstanceOf(ActionNotFoundError);
    expect(await getApproval(db, mine.organizationId, action.id)).toBeNull();

    expect((await getAction(db, theirs.organizationId, action.id))?.status).toBe("proposed");
    expect(await auditOf(mine.organizationId)).not.toContainEqual(
      expect.objectContaining({ targetId: action.id }),
    );
  });

  it("lists by state", async () => {
    const { organizationId, userId } = await company();
    const first = await proposeAction(db, organizationId, proposal({ idempotencyKey: "a" }));
    await proposeAction(db, organizationId, proposal({ idempotencyKey: "b" }));
    await decideAction(db, organizationId, first.action.id, {
      userId,
      decision: "rejected",
      source: "web",
    });

    expect(await listActions(db, organizationId, { statuses: ["proposed"] })).toHaveLength(1);
    expect(
      await listActions(db, organizationId, { statuses: ["proposed", "rejected"] }),
    ).toHaveLength(2);
    expect(await listActions(db, organizationId, { statuses: [] })).toEqual([]);
  });

  it("refuses ids that are not ids", async () => {
    const { organizationId } = await company();
    await expect(getAction(db, organizationId, "1 or 1=1")).rejects.toThrow();
    const stranger = await createTestUser(db, "Nikdo");
    await expect(
      decideAction(db, organizationId, "not-a-uuid", {
        userId: stranger.id,
        decision: "approved",
        source: "web",
      }),
    ).rejects.toThrow();
  });
});
