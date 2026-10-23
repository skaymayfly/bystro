import { ProviderError, Secret } from "@bystro/core";
import { describe, expect, it } from "vitest";

import { createAuthorizationRequest, exchangeAuthorizationCode } from "../oauth/oauth";
import {
  GMAIL_MODIFY_SCOPE,
  GmailClient,
  getGmailProfile,
  gmailOAuthConfig,
  hasGmailScopes,
  revokeGoogleAccess,
} from "./gmail";

const TOKEN = "access-token-plaintext";
const CREDENTIALS = { clientId: "client-id", clientSecret: new Secret("client-secret-plaintext") };
const REDIRECT = "https://bystro.example/api/integrations/gmail/callback";

type Route = { status: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(route: (url: URL) => Route) {
  const calls: { url: URL; method: string; headers: Headers; body: string }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body === undefined || init.body === null ? "" : String(init.body),
    });
    const answer = route(url);
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: answer.headers ?? {},
    });
  }) as typeof fetch;
  return { calls, fetchFn };
}

async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("Expected a ProviderError.");
}

describe("gmailOAuthConfig", () => {
  it("asks Google for offline access to read and send mail, with PKCE", () => {
    const request = createAuthorizationRequest(gmailOAuthConfig(CREDENTIALS), {
      redirectUri: REDIRECT,
      allowedRedirectUris: [REDIRECT],
    });
    const url = new URL(request.url);

    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-id",
      response_type: "code",
      redirect_uri: REDIRECT,
      scope: GMAIL_MODIFY_SCOPE,
      access_type: "offline",
      prompt: "consent",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.codeVerifier).not.toBeNull();
    expect(request.url).not.toContain("client-secret-plaintext");
  });

  it("exchanges the code with the secret in the body and reports the granted scopes", async () => {
    const config = gmailOAuthConfig(CREDENTIALS);
    const request = createAuthorizationRequest(config, {
      redirectUri: REDIRECT,
      allowedRedirectUris: [REDIRECT],
    });
    const fake = fakeFetch(() => ({
      status: 200,
      body: {
        access_token: "new-access",
        expires_in: 3599,
        refresh_token: "new-refresh",
        scope: GMAIL_MODIFY_SCOPE,
        token_type: "Bearer",
      },
    }));

    const tokens = await exchangeAuthorizationCode(
      config,
      { code: "auth-code", stored: request, allowedRedirectUris: [REDIRECT] },
      { fetch: fake.fetchFn },
    );

    expect(fake.calls[0]?.url.toString()).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(fake.calls[0]?.body);
    expect(body.get("client_secret")).toBe("client-secret-plaintext");
    expect(body.get("code_verifier")).toBe(request.codeVerifier?.reveal());
    expect(tokens.scopes).toEqual([GMAIL_MODIFY_SCOPE]);
    expect(hasGmailScopes(tokens.scopes)).toBe(true);
  });
});

describe("hasGmailScopes", () => {
  it("needs the mail scope to have been granted", () => {
    expect(hasGmailScopes([GMAIL_MODIFY_SCOPE, "openid"])).toBe(true);
    // The user unticked access to mail on Google's consent screen.
    expect(hasGmailScopes(["openid"])).toBe(false);
    expect(hasGmailScopes([])).toBe(false);
    expect(hasGmailScopes(null)).toBe(false);
  });
});

describe("revokeGoogleAccess", () => {
  it("posts the token to Google's revocation endpoint", async () => {
    const fake = fakeFetch(() => ({ status: 200 }));

    expect(
      await revokeGoogleAccess(CREDENTIALS, new Secret("refresh-plaintext"), {
        fetch: fake.fetchFn,
      }),
    ).toBe(true);
    expect(fake.calls[0]?.url.toString()).toBe("https://oauth2.googleapis.com/revoke");
    expect(fake.calls[0]?.method).toBe("POST");
    expect(new URLSearchParams(fake.calls[0]?.body).get("token")).toBe("refresh-plaintext");
  });

  it("reports a failure without throwing", async () => {
    const refused = fakeFetch(() => ({ status: 400 }));
    expect(await revokeGoogleAccess(CREDENTIALS, new Secret("r"), { fetch: refused.fetchFn })).toBe(
      false,
    );
    const offline = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await revokeGoogleAccess(CREDENTIALS, new Secret("r"), { fetch: offline })).toBe(false);
  });
});

describe("getGmailProfile", () => {
  it("reads the mailbox address and where its history stands", async () => {
    // Example shaped as in the users.getProfile documentation.
    const fake = fakeFetch(() => ({
      status: 200,
      body: {
        emailAddress: "Petr@Dvorak-Interiery.cz",
        messagesTotal: 1234,
        threadsTotal: 456,
        historyId: "987654",
      },
    }));
    const client = new GmailClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });

    expect(await getGmailProfile(client)).toEqual({
      emailAddress: "petr@dvorak-interiery.cz",
      historyId: "987654",
    });
    expect(fake.calls[0]?.url.toString()).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    );
    expect(fake.calls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("refuses an answer without an address", async () => {
    const fake = fakeFetch(() => ({ status: 200, body: { historyId: "1" } }));
    const client = new GmailClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });

    expect((await providerError(getGmailProfile(client))).code).toBe("invalid_response");
  });

  it.each([
    [401, "reauth_required"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [400, "invalid_response"],
  ])("turns HTTP %i into %s and never leaks the token", async (status, code) => {
    const fake = fakeFetch(() => ({ status, body: { error: { message: `bad ${TOKEN}` } } }));
    const client = new GmailClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });

    const error = await providerError(getGmailProfile(client));

    expect(error.code).toBe(code);
    expect(error.message).not.toContain(TOKEN);
  });

  it("waits as long as Retry-After says", async () => {
    const fake = fakeFetch(() => ({ status: 429, headers: { "Retry-After": "30" } }));
    const client = new GmailClient({ accessToken: new Secret(TOKEN), fetch: fake.fetchFn });

    expect((await providerError(getGmailProfile(client))).retryAfterMs).toBe(30_000);
  });
});
