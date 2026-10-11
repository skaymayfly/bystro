// Local stand-in for Fakturoid's OAuth and user endpoints, used only by E2E tests (never
// against production). The web server under test is pointed at it through
// FAKTUROID_BASE_URL. The consent page is skipped: /oauth sends the browser straight back
// with a code, as Fakturoid does after the user clicks "Povolit".
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const fixtures = new URL("../../../packages/integrations/src/fakturoid/fixtures/", import.meta.url);
const USER = readFileSync(new URL("user.json", fixtures), "utf8");

const port = Number(process.env.FAKTUROID_STUB_PORT ?? 3102);
let revocations = 0;

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const send = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  if (url.pathname === "/health") {
    return send(200, { ok: true });
  }
  // Test-only: how many times access was revoked.
  if (url.pathname === "/__revocations") {
    return send(200, { count: revocations });
  }
  if (request.method === "GET" && url.pathname === "/oauth") {
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "http://invalid.example");
    redirect.searchParams.set("code", "stub-authorization-code");
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { Location: redirect.toString() });
    return response.end();
  }
  if (request.method === "POST" && url.pathname === "/oauth/token") {
    return send(200, {
      access_token: "stub-access-token",
      token_type: "Bearer",
      expires_in: 7200,
      refresh_token: "stub-refresh-token",
    });
  }
  if (request.method === "POST" && url.pathname === "/oauth/revoke") {
    revocations += 1;
    return send(200, {});
  }
  if (request.method === "GET" && url.pathname === "/user.json") {
    return send(200, USER);
  }
  return send(404, { error: "not_found" });
}).listen(port, "127.0.0.1");
