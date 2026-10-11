import { connectionRequest } from "@/server/connection-route";
import { redirectWithin, returnPath } from "@/server/connect-return";
import {
  chooseFakturoidAccount,
  ConnectionFlowError,
  enqueueInitialSync,
} from "@/server/connections";
import { enqueueInvoiceSync, getFakturoidFlow } from "@/server/integrations";

/**
 * POST /api/integrations/connections/{id}/account — picks which Fakturoid account the
 * connection reads, for users who have several. Form body: slug.
 * 303 back to Nastavení → Propojení (`propojeni=ok` or `neplatne`) · 401 · 403 · 404
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const input = await connectionRequest(request, params);
  if (input instanceof Response) {
    return input;
  }
  const flow = getFakturoidFlow();
  const form = await request.formData().catch(() => null);
  const slug = form?.get("slug");
  if (flow === null || typeof slug !== "string" || slug === "") {
    return redirectWithin(input.appBaseUrl, returnPath("settings", "neplatne"));
  }

  try {
    const connection = await chooseFakturoidAccount(flow, input, slug);
    if (connection === null) {
      return redirectWithin(input.appBaseUrl, returnPath("settings", "neplatne"));
    }
    await enqueueInitialSync(enqueueInvoiceSync, connection);
    return redirectWithin(input.appBaseUrl, returnPath("settings", "ok"));
  } catch (error) {
    if (error instanceof ConnectionFlowError) {
      return redirectWithin(input.appBaseUrl, returnPath("settings", "nedostupne"));
    }
    throw error;
  }
}
