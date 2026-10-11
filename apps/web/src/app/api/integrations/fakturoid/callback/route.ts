import { ONBOARDING_PATH, SIGN_IN_PATH } from "@/server/access";
import {
  readReturnTarget,
  redirectWithin,
  returnPath,
  type ConnectOutcome,
} from "@/server/connect-return";
import {
  completeFakturoidConnection,
  ConnectionFlowError,
  enqueueInitialSync,
  type ConnectionFlowErrorCode,
} from "@/server/connections";
import { getRequestContext } from "@/server/context";
import { readAuthEnv } from "@/server/env";
import { enqueueInvoiceSync, getFakturoidFlow } from "@/server/integrations";
import { logger } from "@/server/logger";

const FAILURES: Record<ConnectionFlowErrorCode, ConnectOutcome> = {
  invalid_state: "neplatne",
  denied: "zamitnuto",
  provider_unavailable: "nedostupne",
  no_account: "bez-uctu",
};

/**
 * GET /api/integrations/fakturoid/callback?code=…&state=… — where Fakturoid sends the user
 * back. Always answers with a 303 to a page of this app; the outcome is a code in the
 * query (`propojeni=ok|vybrat-ucet|zamitnuto|neplatne|nedostupne|bez-uctu`). The code is
 * exchanged for tokens only when the `state` belongs to a request this user started.
 */
export async function GET(request: Request) {
  const { baseUrl } = readAuthEnv();
  const context = await getRequestContext();
  if (context === null) {
    return redirectWithin(baseUrl, SIGN_IN_PATH);
  }
  if (context.organization === null) {
    return redirectWithin(baseUrl, ONBOARDING_PATH);
  }

  const target = readReturnTarget(request.headers.get("cookie"));
  const flow = getFakturoidFlow();
  if (flow === null) {
    return redirectWithin(baseUrl, returnPath(target, "nedostupne"));
  }

  const query = new URL(request.url).searchParams;
  try {
    const { connection, needsAccountChoice } = await completeFakturoidConnection(
      flow,
      {
        organization: { id: context.organization.id, ico: context.organization.ico },
        userId: context.user.id,
      },
      { state: query.get("state"), code: query.get("code"), error: query.get("error") },
    );
    const queued = await enqueueInitialSync(enqueueInvoiceSync, connection);
    logger.info(
      { provider: connection.provider, connectionId: connection.id, needsAccountChoice, queued },
      "Integration connected",
    );
    return redirectWithin(baseUrl, returnPath(target, needsAccountChoice ? "vybrat-ucet" : "ok"));
  } catch (error) {
    if (error instanceof ConnectionFlowError) {
      logger.warn({ provider: "fakturoid", code: error.code }, "Integration connection failed");
      return redirectWithin(baseUrl, returnPath(target, FAILURES[error.code]));
    }
    throw error;
  }
}
