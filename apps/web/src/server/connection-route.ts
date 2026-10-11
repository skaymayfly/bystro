import { isSameOrigin, json, requireApiContext } from "./api";
import { readAuthEnv } from "./env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConnectionRequest {
  organizationId: string;
  userId: string;
  connectionId: string;
  appBaseUrl: string;
}

/**
 * Common start of the state-changing connection routes: signed in, same origin, a company,
 * a well-formed connection id. Returns what the handler needs, or the ready error response.
 * Whether the connection belongs to the company is checked by the data layer, which looks
 * it up together with the organization id.
 */
export async function connectionRequest(
  request: Request,
  params: Promise<{ id: string }>,
): Promise<ConnectionRequest | Response> {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }
  const { baseUrl } = readAuthEnv();
  if (!isSameOrigin(request, baseUrl)) {
    return json({ error: "forbidden" }, 403);
  }
  const { id } = await params;
  if (context.organization === null || !UUID.test(id)) {
    return json({ error: "not_found" }, 404);
  }
  return {
    organizationId: context.organization.id,
    userId: context.user.id,
    connectionId: id,
    appBaseUrl: baseUrl,
  };
}
