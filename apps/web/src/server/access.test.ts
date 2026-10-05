import { describe, expect, it } from "vitest";

import { decideAccess, safeNextPath } from "./access";

describe("decideAccess", () => {
  it("lets public pages through without a session", () => {
    for (const path of ["/", "/prihlaseni", "/registrace", "/zapomenute-heslo", "/application"]) {
      expect(decideAccess(path, "", false)).toEqual({ type: "allow" });
    }
  });

  it("redirects unauthenticated visitors of /app to sign-in and remembers the target", () => {
    expect(decideAccess("/app", "", false)).toEqual({
      type: "redirect",
      location: "/prihlaseni?next=%2Fapp",
    });
    expect(decideAccess("/app/faktury", "?tab=overdue", false)).toEqual({
      type: "redirect",
      location: "/prihlaseni?next=%2Fapp%2Ffaktury%3Ftab%3Doverdue",
    });
  });

  it("redirects unauthenticated visitors of onboarding to sign-in", () => {
    expect(decideAccess("/onboarding", "?krok=2", false)).toEqual({
      type: "redirect",
      location: "/prihlaseni?next=%2Fonboarding%3Fkrok%3D2",
    });
    expect(decideAccess("/onboarding", "", true)).toEqual({ type: "allow" });
  });

  it("lets /app through when a session cookie is present", () => {
    expect(decideAccess("/app/faktury", "", true)).toEqual({ type: "allow" });
  });

  it("denies every API route without a session, except the public ones", () => {
    expect(decideAccess("/api/invoices", "", false)).toEqual({ type: "unauthorized" });
    expect(decideAccess("/api", "", false)).toEqual({ type: "unauthorized" });
    expect(decideAccess("/api/authx", "", false)).toEqual({ type: "unauthorized" });
    expect(decideAccess("/api/auth/sign-in/email", "", false)).toEqual({ type: "allow" });
    expect(decideAccess("/api/auth", "", false)).toEqual({ type: "allow" });
    expect(decideAccess("/api/health", "", false)).toEqual({ type: "allow" });
    expect(decideAccess("/api/healthz", "", false)).toEqual({ type: "unauthorized" });
  });

  it("lets API routes through when a session cookie is present", () => {
    expect(decideAccess("/api/invoices", "", true)).toEqual({ type: "allow" });
  });
});

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/faktury?tab=overdue")).toBe("/app/faktury?tab=overdue");
  });

  it("falls back to the app home for anything else", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "/",
      "/prihlaseni",
      "https://evil.example/app",
      "//evil.example/app",
      "/app//evil.example",
      "/app\\evil",
      "/application",
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(bad)).toBe("/app");
    }
  });
});
