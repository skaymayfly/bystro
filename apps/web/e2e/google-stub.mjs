// Local stand-in for Google's OAuth endpoints, Gmail's profile and archiving of threads,
// used only by E2E tests (never against production). The web server under test reaches it
// through GMAIL_TEST_BASE_URL. The consent screen is skipped: the authorization endpoint
// sends the browser straight back with a code, as Google does after the user allows it.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.GOOGLE_STUB_PORT ?? 3104);
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
let revocations = 0;
/** Thread ids archived through threads.modify, with the labels removed. */
const modified = [];
let codes = 0;
/** PKCE challenges by the code they were issued for; a code is good once. */
const challenges = new Map();

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(new URLSearchParams(body)));
  });
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const send = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };

  if (url.pathname === "/health") {
    return send(200, { ok: true });
  }
  // Test-only: which threads were modified (archived).
  if (url.pathname === "/__modified") {
    return send(200, { threads: modified });
  }
  // Test-only: how many times access was revoked.
  if (url.pathname === "/__revocations") {
    return send(200, { count: revocations });
  }
  if (request.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
    const challenge = url.searchParams.get("code_challenge");
    if (
      url.searchParams.get("scope") !== SCOPE ||
      url.searchParams.get("access_type") !== "offline" ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      challenge === null
    ) {
      return send(400, { error: "invalid_request" });
    }
    codes += 1;
    const code = `stub-google-code-${codes}`;
    challenges.set(code, challenge);
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "http://invalid.example");
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { Location: redirect.toString() });
    return response.end();
  }
  if (request.method === "POST" && url.pathname === "/token") {
    const form = await readBody(request);
    const expected = challenges.get(form.get("code"));
    challenges.delete(form.get("code"));
    const verifier = form.get("code_verifier") ?? "";
    if (
      expected === undefined ||
      createHash("sha256").update(verifier).digest("base64url") !== expected ||
      form.get("client_secret") !== "e2e-google-secret"
    ) {
      return send(400, { error: "invalid_grant" });
    }
    return send(200, {
      access_token: "stub-google-access-token",
      expires_in: 3599,
      refresh_token: "stub-google-refresh-token",
      scope: SCOPE,
      token_type: "Bearer",
    });
  }
  if (request.method === "POST" && url.pathname === "/revoke") {
    revocations += 1;
    return send(200, {});
  }
  if (request.method === "GET" && url.pathname === "/gmail/v1/users/me/profile") {
    if (request.headers.authorization !== "Bearer stub-google-access-token") {
      return send(401, {});
    }
    return send(200, {
      emailAddress: "petr@dvorak-interiery.cz",
      messagesTotal: 12,
      threadsTotal: 7,
      historyId: "4242",
    });
  }
  const modify = /^\/gmail\/v1\/users\/me\/threads\/([A-Za-z0-9_-]+)\/modify$/.exec(url.pathname);
  if (request.method === "POST" && modify !== null) {
    if (request.headers.authorization !== "Bearer stub-google-access-token") {
      return send(401, {});
    }
    const body = await new Promise((resolve) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => resolve(JSON.parse(text || "{}")));
    });
    modified.push({ id: modify[1], removeLabelIds: body.removeLabelIds ?? [] });
    return send(200, { id: modify[1], historyId: "4243" });
  }
  return send(404, { error: "not_found" });
}).listen(port, "127.0.0.1");
