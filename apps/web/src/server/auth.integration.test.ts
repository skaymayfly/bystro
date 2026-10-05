import { randomUUID } from "node:crypto";

import { createDb, createOrganization } from "@bystro/db";
import { readTestDatabase } from "@bystro/db/testing";
import { FakeEmailSender } from "@bystro/integrations/testing";
import { createLogger } from "@bystro/observability";
import { afterAll, describe, expect, it } from "vitest";

import { createAuth } from "./auth-config";
import { resolveRequestContext } from "./context";

const BASE_URL = "http://localhost:3000";
const { db, close } = createDb(readTestDatabase().url);

/** Everything Better Auth and our own code log during the tests ends up here. */
const logLines: string[] = [];
const logger = createLogger({
  service: "web-test",
  level: "debug",
  destination: { write: (line: string) => void logLines.push(line) },
});

function setup() {
  const emailSender = new FakeEmailSender();
  const auth = createAuth({
    db,
    emailSender,
    env: { secret: "test-secret-test-secret-test-secret-1234", baseUrl: BASE_URL },
    logger,
  });
  return { auth, emailSender };
}

const newEmail = () => `user-${randomUUID()}@example.test`;

async function signUp(auth: ReturnType<typeof setup>["auth"], password = "puvodni-heslo-1") {
  const email = newEmail();
  const result = await auth.api.signUpEmail({ body: { name: "Petr Dvořák", email, password } });
  return { email, password, user: result.user };
}

/** Signs in and reports only whether it worked. */
async function canSignIn(auth: ReturnType<typeof setup>["auth"], email: string, password: string) {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return response.ok;
}

/** The reset e-mail is sent without awaiting, so give it a moment to arrive. */
async function waitForEmails(emailSender: FakeEmailSender, count: number) {
  await expect.poll(() => emailSender.sent.length, { timeout: 2000 }).toBe(count);
}

function resetTokenFrom(text: string): string {
  const link = text.split("\n").find((line) => line.startsWith(BASE_URL));
  expect(link, "reset e-mail must contain a link to the app").toBeDefined();
  const token = new URL(link as string).pathname.split("/").at(-1);
  expect(token).toBeTruthy();
  return token as string;
}

afterAll(async () => {
  await close();
});

describe("registration and sign-in", () => {
  it("registers a user with a UUID id and lets them sign in", async () => {
    const { auth } = setup();
    const { email, password, user } = await signUp(auth);

    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(user.email).toBe(email);
    expect(await canSignIn(auth, email, password)).toBe(true);
  });

  it("rejects a wrong password and an unknown e-mail the same way", async () => {
    const { auth } = setup();
    const { email } = await signUp(auth);

    const wrongPassword = await auth.api.signInEmail({
      body: { email, password: "spatne-heslo" },
      asResponse: true,
    });
    const unknownEmail = await auth.api.signInEmail({
      body: { email: newEmail(), password: "spatne-heslo" },
      asResponse: true,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const { auth } = setup();
    const response = await auth.api.signUpEmail({
      body: { name: "Krátké Heslo", email: newEmail(), password: "1234567" },
      asResponse: true,
    });

    expect(response.ok).toBe(false);
    expect(((await response.json()) as { code?: string }).code).toBe("PASSWORD_TOO_SHORT");
  });

  it("does not allow a second account with the same e-mail", async () => {
    const { auth } = setup();
    const { email } = await signUp(auth);
    const response = await auth.api.signUpEmail({
      body: { name: "Druhý", email, password: "jine-heslo-123" },
      asResponse: true,
    });

    expect(response.ok).toBe(false);
  });
});

describe("password reset", () => {
  it("sends one e-mail to the account's address and the link sets a new password", async () => {
    const { auth, emailSender } = setup();
    const { email, password } = await signUp(auth);

    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/obnova-hesla" } });
    await waitForEmails(emailSender, 1);

    const message = emailSender.sent[0];
    expect(message?.to).toBe(email);
    expect(message?.subject).toBe("Nové heslo do Bystra");

    const token = resetTokenFrom(message?.text ?? "");
    await auth.api.resetPassword({ body: { newPassword: "nove-heslo-456", token } });

    expect(await canSignIn(auth, email, "nove-heslo-456")).toBe(true);
    expect(await canSignIn(auth, email, password)).toBe(false);
  });

  it("a reset link works only once", async () => {
    const { auth, emailSender } = setup();
    const { email } = await signUp(auth);
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/obnova-hesla" } });
    await waitForEmails(emailSender, 1);
    const token = resetTokenFrom(emailSender.sent[0]?.text ?? "");

    await auth.api.resetPassword({ body: { newPassword: "nove-heslo-456", token } });
    const second = await auth.api.resetPassword({
      body: { newPassword: "utocnik-heslo-789", token },
      asResponse: true,
    });

    expect(second.ok).toBe(false);
    expect(await canSignIn(auth, email, "utocnik-heslo-789")).toBe(false);
  });

  it("signs out existing sessions after a reset", async () => {
    const { auth, emailSender } = setup();
    const email = newEmail();
    const signUpResponse = await auth.api.signUpEmail({
      body: { name: "Petr Dvořák", email, password: "puvodni-heslo-1" },
      asResponse: true,
    });
    const cookie = signUpResponse.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const headers = new Headers({ cookie });
    expect((await auth.api.getSession({ headers }))?.user.email).toBe(email);

    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/obnova-hesla" } });
    await waitForEmails(emailSender, 1);
    const token = resetTokenFrom(emailSender.sent[0]?.text ?? "");
    await auth.api.resetPassword({ body: { newPassword: "nove-heslo-456", token } });

    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("sends nothing for an unknown address and answers the same as for a known one", async () => {
    const { auth, emailSender } = setup();
    const { email } = await signUp(auth);

    const known = await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/obnova-hesla" },
      asResponse: true,
    });
    await waitForEmails(emailSender, 1);
    const unknown = await auth.api.requestPasswordReset({
      body: { email: newEmail(), redirectTo: "/obnova-hesla" },
      asResponse: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(emailSender.sent).toHaveLength(1);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("rejects a made-up token", async () => {
    const { auth } = setup();
    const response = await auth.api.resetPassword({
      body: { newPassword: "nove-heslo-456", token: "not-a-real-token" },
      asResponse: true,
    });
    expect(response.ok).toBe(false);
  });
});

describe("OAuth tokens", () => {
  it("are never stored, even when a provider returns them", async () => {
    const { auth } = setup();
    const { user } = await signUp(auth);
    const { internalAdapter } = await auth.$context;

    await internalAdapter.createAccount({
      userId: user.id,
      providerId: "google",
      accountId: `google-${randomUUID()}`,
      accessToken: "ya29.secret-access-token",
      refreshToken: "1//secret-refresh-token",
      idToken: "eyJ.secret-id-token",
      scope: "openid email profile",
    });

    const accounts = await internalAdapter.findAccounts(user.id);
    const google = accounts.find((account) => account.providerId === "google");
    expect(google).toBeDefined();
    expect(google?.accessToken ?? null).toBeNull();
    expect(google?.refreshToken ?? null).toBeNull();
    expect(google?.idToken ?? null).toBeNull();
    expect(JSON.stringify(accounts)).not.toContain("secret");
  });
});

describe("resolveRequestContext", () => {
  it("has no organization for a user who has not created one yet", async () => {
    const { auth } = setup();
    const { user, email } = await signUp(auth);

    expect(await resolveRequestContext(db, { id: user.id, name: user.name, email })).toEqual({
      user: { id: user.id, name: user.name, email },
      organization: null,
      role: null,
    });
  });

  it("returns the user's own organization and role, never someone else's", async () => {
    const { auth } = setup();
    const owner = await signUp(auth);
    const stranger = await signUp(auth);
    const organization = await createOrganization(db, {
      organization: { name: "Dvořák Interiéry s.r.o.", ico: "27074358" },
      ownerUserId: owner.user.id,
      source: "web",
    });

    const ownerContext = await resolveRequestContext(db, {
      id: owner.user.id,
      name: owner.user.name,
      email: owner.email,
    });
    const strangerContext = await resolveRequestContext(db, {
      id: stranger.user.id,
      name: stranger.user.name,
      email: stranger.email,
    });

    expect(ownerContext.organization?.id).toBe(organization.id);
    expect(ownerContext.role).toBe("owner");
    expect(strangerContext.organization).toBeNull();
    expect(strangerContext.role).toBeNull();
  });
});

describe("logging", () => {
  it("keeps e-mail addresses, passwords and reset tokens out of the logs", async () => {
    const { auth, emailSender } = setup();
    const { email, password } = await signUp(auth);

    // Trigger the paths that make Better Auth log: failed sign-ins and a password reset.
    await canSignIn(auth, email, "spatne-heslo-999");
    await canSignIn(auth, newEmail(), "spatne-heslo-999");
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/obnova-hesla" } });
    await waitForEmails(emailSender, 1);
    const token = resetTokenFrom(emailSender.sent[0]?.text ?? "");
    await auth.api.requestPasswordReset({
      body: { email: newEmail(), redirectTo: "/obnova-hesla" },
    });

    const output = logLines.join("");
    expect(output).toContain("better-auth");
    expect(output).not.toContain(email);
    expect(output).not.toContain(password);
    expect(output).not.toContain("spatne-heslo-999");
    expect(output).not.toContain(token);
    expect(output).not.toMatch(/@example\.test/);
  });
});
