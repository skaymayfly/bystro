import { describe, expect, it } from "vitest";

import {
  canStartSync,
  canTransitionIntegration,
  INTEGRATION_EVENTS,
  INTEGRATION_STATUSES,
  IntegrationTransitionError,
  transitionIntegration,
  type IntegrationEvent,
  type IntegrationStatus,
} from "./integration-status";

/** The complete list of allowed transitions; everything else must throw. */
const ALLOWED: [IntegrationStatus, IntegrationEvent, IntegrationStatus][] = [
  ["connected", "sync_started", "syncing"],
  ["connected", "auth_failed", "reauth_required"],
  ["connected", "revoked", "revoked"],
  ["syncing", "sync_succeeded", "connected"],
  ["syncing", "sync_degraded", "degraded"],
  ["syncing", "sync_failed", "error"],
  ["syncing", "auth_failed", "reauth_required"],
  ["syncing", "revoked", "revoked"],
  ["degraded", "sync_started", "syncing"],
  ["degraded", "auth_failed", "reauth_required"],
  ["degraded", "revoked", "revoked"],
  ["error", "sync_started", "syncing"],
  ["error", "auth_failed", "reauth_required"],
  ["error", "revoked", "revoked"],
  ["reauth_required", "reconnected", "connected"],
  ["reauth_required", "revoked", "revoked"],
  ["revoked", "reconnected", "connected"],
];

const isAllowed = (status: IntegrationStatus, event: IntegrationEvent) =>
  ALLOWED.some(([from, on]) => from === status && on === event);

describe("transitionIntegration", () => {
  it.each(ALLOWED)("%s + %s → %s", (status, event, expected) => {
    expect(transitionIntegration(status, event)).toBe(expected);
    expect(canTransitionIntegration(status, event)).toBe(true);
  });

  it("rejects every other combination of status and event", () => {
    let rejected = 0;
    for (const status of INTEGRATION_STATUSES) {
      for (const event of INTEGRATION_EVENTS) {
        if (isAllowed(status, event)) {
          continue;
        }
        expect(() => transitionIntegration(status, event), `${status} + ${event}`).toThrow(
          IntegrationTransitionError,
        );
        expect(canTransitionIntegration(status, event)).toBe(false);
        rejected += 1;
      }
    }
    expect(rejected).toBe(INTEGRATION_STATUSES.length * INTEGRATION_EVENTS.length - ALLOWED.length);
  });

  it("explains what was attempted", () => {
    try {
      transitionIntegration("revoked", "sync_started");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationTransitionError);
      expect((error as IntegrationTransitionError).status).toBe("revoked");
      expect((error as IntegrationTransitionError).event).toBe("sync_started");
      expect((error as Error).message).toContain("revoked");
    }
  });
});

describe("rules that follow from the state machine", () => {
  it("a sync cannot start while one runs or without valid credentials", () => {
    expect(canStartSync("connected")).toBe(true);
    expect(canStartSync("degraded")).toBe(true);
    expect(canStartSync("error")).toBe(true);
    expect(canStartSync("syncing")).toBe(false);
    expect(canStartSync("reauth_required")).toBe(false);
    expect(canStartSync("revoked")).toBe(false);
  });

  it("a sync result is only accepted while syncing", () => {
    for (const status of INTEGRATION_STATUSES.filter((s) => s !== "syncing")) {
      for (const event of ["sync_succeeded", "sync_degraded", "sync_failed"] as const) {
        expect(canTransitionIntegration(status, event), `${status} + ${event}`).toBe(false);
      }
    }
  });

  it("losing authorization is only undone by connecting again", () => {
    for (const status of ["reauth_required", "revoked"] as const) {
      const ways = INTEGRATION_EVENTS.filter(
        (event) =>
          canTransitionIntegration(status, event) &&
          transitionIntegration(status, event) !== "revoked",
      );
      expect(ways).toEqual(["reconnected"]);
    }
  });

  it("every status except revoked can be revoked", () => {
    for (const status of INTEGRATION_STATUSES.filter((s) => s !== "revoked")) {
      expect(transitionIntegration(status, "revoked")).toBe("revoked");
    }
  });
});
