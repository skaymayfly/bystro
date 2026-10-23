import { randomBytes } from "node:crypto";

import { Secret } from "@bystro/core";
import { createDb, getConnection, listConnections, readConnectionTokens } from "@bystro/db";
import { createTestOrganization, readTestDatabase } from "@bystro/db/testing";
import { GMAIL_MODIFY_SCOPE } from "@bystro/integrations";
import { afterAll, describe, expect, it } from "vitest";

import {
  completeGmailConnection,
  ConnectionFlowError,
  disconnect,
  enqueueInitialSync,
  requestManualSync,
  startGmailConnection,
  type GmailFlowDeps,
} from "./connections";

const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);
const APP_URL = "https://bystro.example";

afterAll(async () => {
  await close();
});

interface FakeGoogle {
  scope: string;
  profileStatus: number;
  requests: { method: string; url: URL; body: string; authorization: string | null }[];
}

/** A stand-in for Google's token and revocation endpoints and Gmail's profile. */
function fakeGoogle(overrides: Partial<FakeGoogle> = {}) {
  const state: FakeGoogle = {
    scope: GMAIL_MODIFY_SCOPE,
    profileStatus: 200,
    requests: [],
    ...overrides,
  };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    state.requests.push({
      method: init?.method ?? "GET",
      url,
      body: String(init?.body ?? ""),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.pathname === "/token") {
      return Response.json({
        access_token: "google-access-plain",
        expires_in: 3599,
        refresh_token: "google-refresh-plain",
        scope: state.scope,
        token_type: "Bearer",
      });
    }
    if (url.pathname === "/revoke") {
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/gmail/v1/users/me/profile") {
      return state.profileStatus === 200
        ? Response.json({
            emailAddress: "Petr@Dvorak-Interiery.cz",
            messagesTotal: 10,
            threadsTotal: 5,
            historyId: "12345",
          })
        : new Response(null, { status: state.profileStatus });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { state, fetchFn };
}

const STUB = "https://google.stub";

function flow(fetchFn: typeof fetch): GmailFlowDeps & { fakturoid: null; idoklad: null } {
  return {
    db,
    encryptionKey: key,
    appBaseUrl: APP_URL,
    fetch: fetchFn,
    gmail: {
      clientId: "google-client-id",
      clientSecret: new Secret("google-client-secret"),
      endpoints: {
        authorization: `${STUB}/o/oauth2/v2/auth`,
        token: `${STUB}/token`,
        revocation: `${STUB}/revoke`,
        gmailApi: `${STUB}/gmail/v1`,
      },
    },
    fakturoid: null,
    idoklad: null,
  };
}

async function company(name = "Firma A") {
  const { organization, owner } = await createTestOrganization(db, name);
  return { organization: { id: organization.id }, userId: owner.id };
}

async function started(deps: GmailFlowDeps, who: Awaited<ReturnType<typeof company>>) {
  const url = new URL(
    await startGmailConnection(deps, { organizationId: who.organization.id, userId: who.userId }),
  );
  return { url, state: url.searchParams.get("state") as string };
}

const callback = (state: string, extra: { code?: string | null; error?: string } = {}) => ({
  state,
  code: extra.code === undefined ? "auth-code" : extra.code,
  error: extra.error ?? null,
});

async function flowError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectionFlowError);
    return (error as ConnectionFlowError).code;
  }
  throw new Error("expected a ConnectionFlowError");
}

describe("connecting Gmail", () => {
  it("sends the user to Google for offline access to mail, with PKCE and nothing secret", async () => {
    const who = await company();
    const { url } = await started(flow(fakeGoogle().fetchFn), who);

    expect(`${url.origin}${url.pathname}`).toBe(`${STUB}/o/oauth2/v2/auth`);
    expect(url.searchParams.get("scope")).toBe(GMAIL_MODIFY_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/integrations/gmail/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain("google-client-secret");
  });

  it("saves the mailbox with encrypted tokens and its address", async () => {
    const { state: google, fetchFn } = fakeGoogle();
    const deps = flow(fetchFn);
    const who = await company();
    const { state } = await started(deps, who);

    const { connection, needsAccountChoice } = await completeGmailConnection(
      deps,
      who,
      callback(state),
    );

    expect(needsAccountChoice).toBe(false);
    expect(connection).toMatchObject({
      provider: "gmail",
      category: "email",
      status: "connected",
      externalAccountId: "petr@dvorak-interiery.cz",
      displayName: "petr@dvorak-interiery.cz",
      scopes: [GMAIL_MODIFY_SCOPE],
    });
    expect(JSON.stringify(connection)).not.toMatch(/google-access-plain|google-refresh-plain/);
    const tokens = await readConnectionTokens(db, who.organization.id, connection.id, key);
    expect(tokens?.refreshToken?.reveal()).toBe("google-refresh-plain");

    const exchange = google.requests.find((request) => request.url.pathname === "/token");
    const body = new URLSearchParams(exchange?.body);
    expect(body.get("client_secret")).toBe("google-client-secret");
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const profile = google.requests.find((request) => request.url.pathname.endsWith("/profile"));
    expect(profile?.authorization).toBe("Bearer google-access-plain");
  });

  it("gives the access back when the user unticked access to mail", async () => {
    const { state: google, fetchFn } = fakeGoogle({ scope: "openid" });
    const deps = flow(fetchFn);
    const who = await company();
    const { state } = await started(deps, who);

    expect(await flowError(completeGmailConnection(deps, who, callback(state)))).toBe(
      "missing_scope",
    );

    expect(await listConnections(db, who.organization.id)).toHaveLength(0);
    const revocation = google.requests.find((request) => request.url.pathname === "/revoke");
    expect(new URLSearchParams(revocation?.body).get("token")).toBe("google-refresh-plain");
    // Gmail itself is not asked anything.
    expect(google.requests.some((request) => request.url.pathname.endsWith("/profile"))).toBe(
      false,
    );
  });

  it("gives the access back when the mailbox cannot be read", async () => {
    for (const [profileStatus, code] of [
      [403, "account_blocked"],
      [500, "provider_unavailable"],
    ] as const) {
      const { state: google, fetchFn } = fakeGoogle({ profileStatus });
      const deps = flow(fetchFn);
      const who = await company();
      const { state } = await started(deps, who);

      expect(await flowError(completeGmailConnection(deps, who, callback(state)))).toBe(code);

      expect(await listConnections(db, who.organization.id)).toHaveLength(0);
      expect(google.requests.some((request) => request.url.pathname === "/revoke")).toBe(true);
    }
  });

  it("refuses a state that is made up, someone else's or already used", async () => {
    const deps = flow(fakeGoogle().fetchFn);
    const who = await company();
    const other = await company("Firma B");
    const { state } = await started(deps, who);

    expect(await flowError(completeGmailConnection(deps, other, callback(state)))).toBe(
      "invalid_state",
    );
    expect(await flowError(completeGmailConnection(deps, who, callback("made-up")))).toBe(
      "invalid_state",
    );
    await completeGmailConnection(deps, who, callback(state));
    expect(await flowError(completeGmailConnection(deps, who, callback(state)))).toBe(
      "invalid_state",
    );
    expect(
      await flowError(
        completeGmailConnection(
          deps,
          who,
          callback((await started(deps, who)).state, { code: null, error: "access_denied" }),
        ),
      ),
    ).toBe("denied");
  });

  it("starts no invoice sync for a mailbox, not even on request", async () => {
    const deps = flow(fakeGoogle().fetchFn);
    const who = await company();
    const { state } = await started(deps, who);
    const { connection } = await completeGmailConnection(deps, who, callback(state));
    const enqueued: unknown[] = [];
    const enqueue = async (data: unknown) => {
      enqueued.push(data);
      return true;
    };

    expect(await enqueueInitialSync(enqueue, connection)).toBe(false);
    expect(
      await requestManualSync(
        { db, enqueue },
        { organizationId: who.organization.id, connectionId: connection.id },
      ),
    ).toBe("not_syncable");
    expect(enqueued).toEqual([]);
  });

  it("revokes the access at Google on disconnect and forgets the tokens", async () => {
    const { state: google, fetchFn } = fakeGoogle();
    const deps = flow(fetchFn);
    const who = await company();
    const { state } = await started(deps, who);
    const { connection } = await completeGmailConnection(deps, who, callback(state));
    google.requests.length = 0;

    expect(
      await disconnect(deps, {
        organizationId: who.organization.id,
        connectionId: connection.id,
        userId: who.userId,
      }),
    ).toBe(true);

    expect(google.requests.map((request) => request.url.pathname)).toEqual(["/revoke"]);
    expect(new URLSearchParams(google.requests[0]?.body).get("token")).toBe("google-refresh-plain");
    expect(await readConnectionTokens(db, who.organization.id, connection.id, key)).toBeNull();
    expect((await getConnection(db, who.organization.id, connection.id))?.status).toBe("revoked");
  });
});
