// Local stand-in for the ARES API, used only by E2E tests (never against production).
// It replays responses recorded from the real API; the web server under test is pointed
// at it through ARES_BASE_URL.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const fixtures = new URL("../../../packages/integrations/src/ares/fixtures/", import.meta.url);
const fixture = (name) => readFileSync(new URL(name, fixtures), "utf8");

const FOUND = { 27074358: fixture("found-company.json") };
/** IČO for which the stub pretends ARES is down. */
const OUTAGE = new Set(["45274649"]);
const NOT_FOUND = fixture("not-found.json");

const port = Number(process.env.ARES_STUB_PORT ?? 3101);

createServer((request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(body);
  };

  if (request.url === "/health") {
    return send(200, '{"ok":true}');
  }
  const ico = /^\/ekonomicke-subjekty\/(\d{8})$/.exec(request.url ?? "")?.[1];
  if (ico === undefined) {
    return send(400, '{"kod":"CHYBA_VSTUPU"}');
  }
  if (OUTAGE.has(ico)) {
    return send(500, '{"kod":"OBECNA_CHYBA","popis":"Neočekávaná chyba"}');
  }
  return FOUND[ico] === undefined ? send(404, NOT_FOUND) : send(200, FOUND[ico]);
}).listen(port, "127.0.0.1");
