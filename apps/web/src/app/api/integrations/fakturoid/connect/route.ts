import { isSameOrigin, json, requireApiContext } from "@/server/api";
import {
  parseReturnTarget,
  redirectWithin,
  returnCookie,
  returnPath,
} from "@/server/connect-return";
import { startFakturoidConnection } from "@/server/connections";
import { readAuthEnv } from "@/server/env";
import { getFakturoidFlow } from "@/server/integrations";

/**
 * POST /api/integrations/fakturoid/connect — starts connecting Fakturoid.
 * Form body: returnTo = "settings" | "onboarding".
 * 303 to Fakturoid's consent page (or back to the app when Fakturoid is not configured)
 * · 401 · 403 { error: "forbidden" } · 409 { error: "no_organization" }
 */
export async function POST(request: Request) {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }
  const { baseUrl } = readAuthEnv();
  if (!isSameOrigin(request, baseUrl)) {
    return json({ error: "forbidden" }, 403);
  }
  if (context.organization === null) {
    return json({ error: "no_organization" }, 409);
  }

  const form = await request.formData().catch(() => null);
  const target = parseReturnTarget(form?.get("returnTo"));
  const flow = getFakturoidFlow();
  if (flow === null) {
    return redirectWithin(baseUrl, returnPath(target, "nedostupne"));
  }

  const url = await startFakturoidConnection(flow, {
    organizationId: context.organization.id,
    userId: context.user.id,
  });
  return new Response(null, {
    status: 303,
    headers: {
      Location: url,
      "Cache-Control": "no-store",
      "Set-Cookie": returnCookie(target, baseUrl),
    },
  });
}
