import { createHash } from "node:crypto";

import { Secret } from "@bystro/core";
import { describe, expect, it } from "vitest";

import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  hashOAuthState,
  OAuthError,
  refreshAccessToken,
  verifyCallback,
  type OAuthErrorCode,
  type OAuthProviderConfig,
} from "./oauth";

const CLIENT_SECRET = "client-secret-value";
const REDIRECT = "https://app.bystro.cz/api/integrations/example/callback";
const ALLOWED = [REDIRECT, "http://localhost:3000/api/integrations/example/callback"];
const NOW = new Date("2026-10-05T10:00:00Z");

const config: OAuthProviderConfig = {
  id: "example",
  authorizationEndpoint: "https://provider.example/oauth/authorize",
  tokenEndpoint: "https://provider.example/oauth/token",
  clientId: "client-id",
  clientSecret: new Secret(CLIENT_SECRET),
  scopes: ["invoices:read", "clients:read"],
  pkce: "S256",
  clientAuthentication: "basic",
};
const noPkceConfig: OAuthProviderConfig = { ...config, pkce: "none" };

function start(provider = config) {
  const request = createAuthorizationRequest(provider, {
    redirectUri: REDIRECT,
    allowedRedirectUris: ALLOWED,
    now: NOW,
  });
  const state = new URL(request.url).searchParams.get("state") as string;
  return { request, state };
}

function expectOAuthError(action: () => unknown, code: OAuthErrorCode) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected OAuthError ${code}`);
}

async function expectOAuthRejection(promise: Promise<unknown>, code: OAuthErrorCode) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(OAuthError);
  expect((error as OAuthError).code).toBe(code);
  return error as OAuthError;
}

/** Fake token endpoint that records the request. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("createAuthorizationRequest", () => {
  it("builds the provider URL with state and a PKCE challenge", () => {
    const { request, state } = start();
    const url = new URL(request.url);

    expect(`${url.origin}${url.pathname}`).toBe(config.authorizationEndpoint);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("scope")).toBe("invoices:read clients:read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state.length).toBeGreaterThanOrEqual(43);

    const verifier = request.codeVerifier?.reveal() as string;
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
    expect(request.expiresAt.getTime() - NOW.getTime()).toBe(10 * 60 * 1000);
    expect(request.consumedAt).toBeNull();
  });

  it("keeps secrets out of the URL and stores only a hash of the state", () => {
    const { request, state } = start();

    expect(request.url).not.toContain(CLIENT_SECRET);
    expect(request.url).not.toContain(request.codeVerifier?.reveal() as string);
    expect(request.stateHash).toBe(hashOAuthState(state));
    expect(request.stateHash).not.toContain(state);
    expect(JSON.stringify(request)).not.toContain(request.codeVerifier?.reveal() as string);
  });

  it("uses fresh random values every time", () => {
    const values = Array.from({ length: 20 }, () => start());
    expect(new Set(values.map((v) => v.state)).size).toBe(20);
    expect(new Set(values.map((v) => v.request.codeVerifier?.reveal())).size).toBe(20);
  });

  it("omits PKCE only for providers configured without it", () => {
    const { request } = start(noPkceConfig);
    expect(new URL(request.url).searchParams.has("code_challenge")).toBe(false);
    expect(request.codeVerifier).toBeNull();
  });

  it("refuses a redirect URI that is not on the allowlist", () => {
    for (const redirectUri of [
      "https://evil.example/callback",
      `${REDIRECT}/extra`,
      `${REDIRECT}?next=https://evil.example`,
      REDIRECT.replace("https://", "http://"),
      "",
    ]) {
      expectOAuthError(
        () => createAuthorizationRequest(config, { redirectUri, allowedRedirectUris: ALLOWED }),
        "redirect_uri_not_allowed",
      );
    }
  });

  it("adds provider-specific parameters without letting them override the standard ones", () => {
    const request = createAuthorizationRequest(
      { ...config, extraAuthorizationParams: { access_type: "offline", client_id: "spoofed" } },
      { redirectUri: REDIRECT, allowedRedirectUris: ALLOWED },
    );
    const params = new URL(request.url).searchParams;
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("client_id")).toBe("client-id");
  });
});

describe("verifyCallback", () => {
  const callback = (
    overrides: {
      params?: { state?: string | null; code?: string | null; error?: string | null };
      stored?: Partial<ReturnType<typeof start>["request"]> | null;
      now?: Date;
      provider?: OAuthProviderConfig;
    } = {},
  ) => {
    const { request, state } = start(overrides.provider ?? config);
    return () =>
      verifyCallback(overrides.provider ?? config, {
        params: { state, code: "auth-code", ...overrides.params },
        stored: overrides.stored === null ? null : { ...request, ...overrides.stored },
        allowedRedirectUris: ALLOWED,
        now: overrides.now ?? new Date(NOW.getTime() + 60_000),
      });
  };

  it("returns the code for a valid callback", () => {
    expect(callback()()).toEqual({ code: "auth-code" });
  });

  it("rejects a missing, unknown or forged state", () => {
    expectOAuthError(callback({ params: { state: null } }), "invalid_state");
    expectOAuthError(callback({ params: { state: "" } }), "invalid_state");
    expectOAuthError(callback({ params: { state: "forged-state-value" } }), "invalid_state");
    expectOAuthError(callback({ stored: null }), "invalid_state");
  });

  it("rejects a request started for another provider", () => {
    expectOAuthError(callback({ stored: { provider: "another" } }), "invalid_state");
  });

  it("rejects a missing PKCE verifier when the provider requires PKCE", () => {
    expectOAuthError(callback({ stored: { codeVerifier: null } }), "pkce_verifier_missing");
  });

  it("accepts a request without a verifier only for providers without PKCE", () => {
    expect(callback({ provider: noPkceConfig })()).toEqual({ code: "auth-code" });
  });

  it("rejects a redirect URI that is not (or no longer) on the allowlist", () => {
    expectOAuthError(
      callback({ stored: { redirectUri: "https://evil.example/callback" } }),
      "redirect_uri_not_allowed",
    );
  });

  it("rejects an expired request", () => {
    expectOAuthError(
      callback({ now: new Date(NOW.getTime() + 10 * 60 * 1000) }),
      "request_expired",
    );
    expect(callback({ now: new Date(NOW.getTime() + 10 * 60 * 1000 - 1) })()).toEqual({
      code: "auth-code",
    });
  });

  it("rejects a request that was already used (replay)", () => {
    expectOAuthError(callback({ stored: { consumedAt: NOW } }), "request_already_used");
  });

  it("reports a denied authorization and a missing code", () => {
    expectOAuthError(
      callback({ params: { error: "access_denied", code: null } }),
      "provider_denied",
    );
    expectOAuthError(callback({ params: { code: null } }), "missing_code");
    expectOAuthError(callback({ params: { code: "" } }), "missing_code");
  });

  it("checks the state before believing a provider error", () => {
    expectOAuthError(
      callback({ params: { state: "forged", error: "access_denied" } }),
      "invalid_state",
    );
  });
});

describe("exchangeAuthorizationCode", () => {
  it("posts the code, redirect URI and PKCE verifier with HTTP Basic client authentication", async () => {
    const { request } = start();
    const { calls, fetchFn } = fakeFetch(200, {
      access_token: "access-token-value",
      refresh_token: "refresh-token-value",
      token_type: "Bearer",
      expires_in: 7200,
      scope: "invoices:read clients:read",
    });

    const tokens = await exchangeAuthorizationCode(
      config,
      { code: "auth-code", stored: request, allowedRedirectUris: ALLOWED },
      { fetch: fetchFn, now: NOW },
    );

    expect(tokens.accessToken.reveal()).toBe("access-token-value");
    expect(tokens.refreshToken?.reveal()).toBe("refresh-token-value");
    expect(tokens.expiresAt).toEqual(new Date(NOW.getTime() + 7200 * 1000));
    expect(tokens.scopes).toEqual(["invoices:read", "clients:read"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(config.tokenEndpoint);
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(`client-id:${CLIENT_SECRET}`).toString("base64")}`,
    );
    const body = calls[0]?.init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "auth-code",
      redirect_uri: REDIRECT,
      code_verifier: request.codeVerifier?.reveal(),
    });
  });

  it("can send client credentials in the body instead", async () => {
    const { request } = start();
    const { calls, fetchFn } = fakeFetch(200, { access_token: "a" });

    await exchangeAuthorizationCode(
      { ...config, clientAuthentication: "body", tokenRequestHeaders: { "User-Agent": "Bystro" } },
      { code: "auth-code", stored: request, allowedRedirectUris: ALLOWED },
      { fetch: fetchFn },
    );

    const headers = calls[0]?.init.headers as Record<string, string>;
    const body = calls[0]?.init.body as URLSearchParams;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["User-Agent"]).toBe("Bystro");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe(CLIENT_SECRET);
  });

  it("returns tokens that do not leak when serialized", async () => {
    const { request } = start();
    const { fetchFn } = fakeFetch(200, {
      access_token: "access-token-value",
      refresh_token: "refresh-token-value",
    });
    const tokens = await exchangeAuthorizationCode(
      config,
      { code: "auth-code", stored: request, allowedRedirectUris: ALLOWED },
      { fetch: fetchFn },
    );

    expect(JSON.stringify(tokens)).not.toMatch(/access-token-value|refresh-token-value/);
    expect(tokens.expiresAt).toBeNull();
    expect(tokens.scopes).toBeNull();
  });

  it("refuses to run without the PKCE verifier or with a foreign redirect URI", async () => {
    const { request } = start();
    const { calls, fetchFn } = fakeFetch(200, { access_token: "a" });

    await expectOAuthRejection(
      exchangeAuthorizationCode(
        config,
        { code: "c", stored: { ...request, codeVerifier: null }, allowedRedirectUris: ALLOWED },
        { fetch: fetchFn },
      ),
      "pkce_verifier_missing",
    );
    await expectOAuthRejection(
      exchangeAuthorizationCode(
        config,
        { code: "c", stored: request, allowedRedirectUris: ["https://other.example/cb"] },
        { fetch: fetchFn },
      ),
      "redirect_uri_not_allowed",
    );
    expect(calls).toHaveLength(0);
  });

  it("reports provider errors without leaking the code, secrets or the provider's text", async () => {
    const { request } = start();
    const { fetchFn } = fakeFetch(400, {
      error: "invalid_grant",
      error_description: `code auth-code-123 for client ${CLIENT_SECRET} is invalid`,
    });

    const error = await expectOAuthRejection(
      exchangeAuthorizationCode(
        config,
        { code: "auth-code-123", stored: request, allowedRedirectUris: ALLOWED },
        { fetch: fetchFn },
      ),
      "token_exchange_failed",
    );

    expect(error.message).toContain("400 invalid_grant");
    expect(error.message).not.toContain("auth-code-123");
    expect(error.message).not.toContain(CLIENT_SECRET);
    expect(error.message).not.toContain(request.codeVerifier?.reveal() as string);
  });

  it("does not pass on a non-standard error value from the provider", async () => {
    const { request } = start();
    const { fetchFn } = fakeFetch(500, { error: `Leaked ${CLIENT_SECRET} <script>` });
    const error = await expectOAuthRejection(
      exchangeAuthorizationCode(
        config,
        { code: "c", stored: request, allowedRedirectUris: ALLOWED },
        { fetch: fetchFn },
      ),
      "token_exchange_failed",
    );
    expect(error.message).toContain("unknown_error");
    expect(error.message).not.toContain(CLIENT_SECRET);
  });

  it("reports a network failure and an unusable response", async () => {
    const { request } = start();
    const failing = (async () => {
      throw new TypeError(`fetch failed for ${CLIENT_SECRET}`);
    }) as unknown as typeof fetch;
    const networkError = await expectOAuthRejection(
      exchangeAuthorizationCode(
        config,
        { code: "c", stored: request, allowedRedirectUris: ALLOWED },
        { fetch: failing },
      ),
      "token_exchange_failed",
    );
    expect(networkError.message).not.toContain(CLIENT_SECRET);

    for (const body of ["<html>not json</html>", {}, { access_token: "" }, { token_type: "x" }]) {
      const { fetchFn } = fakeFetch(200, body);
      await expectOAuthRejection(
        exchangeAuthorizationCode(
          config,
          { code: "c", stored: request, allowedRedirectUris: ALLOWED },
          { fetch: fetchFn },
        ),
        "invalid_token_response",
      );
    }
  });
});

describe("refreshAccessToken", () => {
  const refreshToken = new Secret("refresh-token-value");

  it("exchanges the refresh token for new tokens", async () => {
    const { calls, fetchFn } = fakeFetch(200, { access_token: "new-access", expires_in: "3600" });

    const tokens = await refreshAccessToken(config, { refreshToken }, { fetch: fetchFn, now: NOW });

    expect(tokens.accessToken.reveal()).toBe("new-access");
    // The provider did not rotate the refresh token; the caller keeps the old one.
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.expiresAt).toEqual(new Date(NOW.getTime() + 3600 * 1000));
    expect(Object.fromEntries(calls[0]?.init.body as URLSearchParams)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-token-value",
    });
  });

  it("asks for re-authorization when the provider says the grant is gone", async () => {
    for (const error of ["invalid_grant", "unauthorized_client", "access_denied"]) {
      const { fetchFn } = fakeFetch(400, { error });
      await expectOAuthRejection(
        refreshAccessToken(config, { refreshToken }, { fetch: fetchFn }),
        "reauthorization_required",
      );
    }
  });

  it("treats other failures as temporary, so the connection is not thrown away", async () => {
    for (const [status, body] of [
      [500, { error: "server_error" }],
      [503, "<html>down</html>"],
      [429, { error: "slow_down" }],
      [400, { error: "invalid_request" }],
    ] as const) {
      const { fetchFn } = fakeFetch(status, body);
      const error = await expectOAuthRejection(
        refreshAccessToken(config, { refreshToken }, { fetch: fetchFn }),
        "token_exchange_failed",
      );
      expect(error.message).not.toContain("refresh-token-value");
    }
  });
});
