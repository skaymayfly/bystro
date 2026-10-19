import { describe, expect, it } from "vitest";

import {
  ACTION_EVENTS,
  ACTION_STATUSES,
  ActionTransitionError,
  canTransitionAction,
  FINAL_ACTION_STATUSES,
  isActionExpired,
  transitionAction,
  type ActionEvent,
  type ActionStatus,
} from "./actions";

/** Every allowed change; anything not listed must be refused. */
const ALLOWED: [ActionStatus, ActionEvent, ActionStatus][] = [
  ["proposed", "approve", "approved"],
  ["proposed", "reject", "rejected"],
  ["proposed", "expire", "expired"],
  ["approved", "start", "executing"],
  ["approved", "expire", "expired"],
  ["executing", "succeed", "succeeded"],
  ["executing", "fail", "failed"],
  ["succeeded", "verify", "verified"],
];

describe("transitionAction", () => {
  it.each(ALLOWED)("%s + %s → %s", (status, event, next) => {
    expect(transitionAction(status, event)).toBe(next);
    expect(canTransitionAction(status, event)).toBe(true);
  });

  const forbidden = ACTION_STATUSES.flatMap((status) =>
    ACTION_EVENTS.filter(
      (event) => !ALLOWED.some(([from, allowed]) => from === status && allowed === event),
    ).map((event) => [status, event] as const),
  );

  it("refuses every other combination", () => {
    // 8 states × 7 events, of which 8 are allowed.
    expect(forbidden).toHaveLength(ACTION_STATUSES.length * ACTION_EVENTS.length - ALLOWED.length);
  });

  it.each(forbidden)("%s + %s is refused", (status, event) => {
    expect(canTransitionAction(status, event)).toBe(false);
    expect(() => transitionAction(status, event)).toThrow(ActionTransitionError);
  });

  it("names the state and the event in the error", () => {
    try {
      transitionAction("rejected", "approve");
    } catch (error) {
      expect(error).toMatchObject({ status: "rejected", event: "approve" });
      expect((error as Error).message).toContain('"rejected"');
    }
  });

  it("knows the states nothing can leave", () => {
    expect([...FINAL_ACTION_STATUSES].sort()).toEqual(
      ["expired", "failed", "rejected", "verified"].sort(),
    );
  });

  it("goes the whole happy path in order", () => {
    const path: ActionEvent[] = ["approve", "start", "succeed", "verify"];
    expect(path.reduce<ActionStatus>(transitionAction, "proposed")).toBe("verified");
  });
});

describe("isActionExpired", () => {
  const expiresAt = new Date("2026-10-20T10:00:00Z");

  it("is valid until the limit and expired from that moment on", () => {
    expect(isActionExpired({ expiresAt }, new Date("2026-10-20T09:59:59.999Z"))).toBe(false);
    expect(isActionExpired({ expiresAt }, expiresAt)).toBe(true);
    expect(isActionExpired({ expiresAt }, new Date("2026-10-21T00:00:00Z"))).toBe(true);
  });

  it("never expires without a limit", () => {
    expect(isActionExpired({ expiresAt: null }, new Date("2099-01-01T00:00:00Z"))).toBe(false);
  });
});
