// Local stand-in for iDoklad's identity server and the one API endpoint the connection
// flow calls, used only by E2E tests (never against production). The web server under test
// is pointed at it through IDOKLAD_IDENTITY_BASE_URL and IDOKLAD_BASE_URL. The sign-in page
// is skipped: /server/connect/authorize sends the browser straight back with a code, as
// iDoklad does after the user signs in and allows the access.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.IDOKLAD_STUB_PORT ?? 3103);
let revocations = 0;
/** PKCE challenges by the code they were issued for. */
const challenges = new Map();
let codes = 0;

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
  // Test-only: how many times access was revoked.
  if (url.pathname === "/__revocations") {
    return send(200, { count: revocations });
  }
  if (request.method === "GET" && url.pathname === "/server/connect/authorize") {
    const challenge = url.searchParams.get("code_challenge");
    if (
      url.searchParams.get("scope") !== "idoklad_api offline_access" ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      challenge === null
    ) {
      return send(400, { error: "invalid_request" });
    }
    codes += 1;
    const code = `stub-idoklad-code-${codes}`;
    challenges.set(code, challenge);
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "http://invalid.example");
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { Location: redirect.toString() });
    return response.end();
  }
  if (request.method === "POST" && url.pathname === "/server/connect/token") {
    const form = await readBody(request);
    const expected = challenges.get(form.get("code"));
    const verifier = form.get("code_verifier") ?? "";
    // The code is good once, and only together with the verifier it was started with.
    challenges.delete(form.get("code"));
    if (
      expected === undefined ||
      createHash("sha256").update(verifier).digest("base64url") !== expected ||
      form.get("client_secret") !== "e2e-idoklad-secret"
    ) {
      return send(400, { error: "invalid_grant" });
    }
    return send(200, {
      access_token: "stub-idoklad-access-token",
      token_type: "Bearer",
      expires_in: 6000,
      refresh_token: "stub-idoklad-refresh-token",
    });
  }
  if (request.method === "POST" && url.pathname === "/server/connect/revocation") {
    revocations += 1;
    return send(200, {});
  }
  if (request.method === "GET" && url.pathname === "/v3/Account/CurrentAgenda") {
    if (request.headers.authorization !== "Bearer stub-idoklad-access-token") {
      return send(401, {});
    }
    return send(200, {
      Data: { Id: 4321, Name: "Malíři Hejsek", Contact: { IdentificationNumber: "27074358" } },
      ErrorCode: 0,
      IsSuccess: true,
      StatusCode: 200,
    });
  }
  return send(404, { error: "not_found" });
}).listen(port, "127.0.0.1");
