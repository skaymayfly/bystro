import { isValidIco, normalizeIco } from "@bystro/core";
import { lookupCompanyInAres } from "@bystro/integrations";

import { json, requireApiContext } from "@/server/api";
import { readAresBaseUrl } from "@/server/env";

/**
 * GET /api/companies/lookup?ico=27074358
 * 200 { status: "found", company } | { status: "not_found" } | { status: "unavailable" }
 * 400 { error: "invalid_ico" } · 401 { error: "unauthorized" }
 */
export async function GET(request: Request) {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }

  const ico = normalizeIco(new URL(request.url).searchParams.get("ico") ?? "");
  if (!isValidIco(ico)) {
    return json({ error: "invalid_ico" }, 400);
  }

  const baseUrl = readAresBaseUrl();
  return json(await lookupCompanyInAres(ico, baseUrl === undefined ? {} : { baseUrl }));
}
