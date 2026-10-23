import { ONBOARDING_PATH, SIGN_IN_PATH } from "./access";
import { isSameOrigin, json, requireApiContext } from "./api";
import {
  parseReturnTarget,
  readReturnTarget,
  redirectWithin,
  returnCookie,
  returnPath,
  type ConnectOutcome,
  type ConnectProvider,
} from "./connect-return";
import {
  completeFakturoidConnection,
  completeGmailConnection,
  completeIdokladConnection,
  ConnectionFlowError,
  enqueueInitialMailSync,
  enqueueInitialSync,
  startFakturoidConnection,
  startGmailConnection,
  startIdokladConnection,
  type CallbackParams,
  type CompletedConnection,
  type ConnectionFlowErrorCode,
} from "./connections";
import { getRequestContext } from "./context";
import { readAuthEnv } from "./env";
import {
  enqueueInvoiceSync,
  enqueueMailSync,
  getFakturoidFlow,
  getGmailFlow,
  getIdokladFlow,
} from "./integrations";
import { logger } from "./logger";

/**
 * The two routes every OAuth application has: one that sends the user to the provider and
 * one the provider sends the user back to. The route files only say which provider.
 */

interface Who {
  organization: { id: string; ico: string };
  userId: string;
}

interface ProviderFlow {
  start(who: { organizationId: string; userId: string }): Promise<string>;
  complete(who: Who, params: CallbackParams): Promise<CompletedConnection>;
}

/** The provider's flow, or `null` when this environment has no application for it. */
function providerFlow(provider: ConnectProvider): ProviderFlow | null {
  if (provider === "gmail") {
    const flow = getGmailFlow();
    return flow === null
      ? null
      : {
          start: (who) => startGmailConnection(flow, who),
          complete: (who, params) => completeGmailConnection(flow, who, params),
        };
  }
  if (provider === "idoklad") {
    const flow = getIdokladFlow();
    return flow === null
      ? null
      : {
          start: (who) => startIdokladConnection(flow, who),
          complete: (who, params) => completeIdokladConnection(flow, who, params),
        };
  }
  const flow = getFakturoidFlow();
  return flow === null
    ? null
    : {
        start: (who) => startFakturoidConnection(flow, who),
        complete: (who, params) => completeFakturoidConnection(flow, who, params),
      };
}

const FAILURES: Record<ConnectionFlowErrorCode, ConnectOutcome> = {
  invalid_state: "neplatne",
  denied: "zamitnuto",
  provider_unavailable: "nedostupne",
  no_account: "bez-uctu",
  account_blocked: "tarif",
  missing_scope: "opravneni",
};

/**
 * POST /api/integrations/{provider}/connect — starts connecting.
 * Form body: returnTo = "settings" | "onboarding".
 * 303 to the provider's consent page (or back to the app when the provider is not
 * configured) · 401 · 403 { error: "forbidden" } · 409 { error: "no_organization" }
 */
export async function startConnection(request: Request, provider: ConnectProvider) {
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
  const flow = providerFlow(provider);
  if (flow === null) {
    logger.warn({ provider, code: "not_configured" }, "Integration connection failed");
    return redirectWithin(baseUrl, returnPath(target, "nedostupne", provider));
  }

  const url = await flow.start({
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

/**
 * GET /api/integrations/{provider}/callback?code=…&state=… — where the provider sends the
 * user back. Always answers with a 303 to a page of this app; the outcome is a code in the
 * query (`propojeni=ok|vybrat-ucet|zamitnuto|neplatne|nedostupne|bez-uctu|tarif`). The code
 * is exchanged for tokens only when the `state` belongs to a request this user started.
 */
export async function finishConnection(request: Request, provider: ConnectProvider) {
  const { baseUrl } = readAuthEnv();
  const context = await getRequestContext();
  if (context === null) {
    return redirectWithin(baseUrl, SIGN_IN_PATH);
  }
  if (context.organization === null) {
    return redirectWithin(baseUrl, ONBOARDING_PATH);
  }

  const target = readReturnTarget(request.headers.get("cookie"));
  const flow = providerFlow(provider);
  if (flow === null) {
    logger.warn({ provider, code: "not_configured" }, "Integration connection failed");
    return redirectWithin(baseUrl, returnPath(target, "nedostupne", provider));
  }

  const query = new URL(request.url).searchParams;
  try {
    const { connection, needsAccountChoice } = await flow.complete(
      {
        organization: { id: context.organization.id, ico: context.organization.ico },
        userId: context.user.id,
      },
      { state: query.get("state"), code: query.get("code"), error: query.get("error") },
    );
    const queued =
      (await enqueueInitialSync(enqueueInvoiceSync, connection)) ||
      (await enqueueInitialMailSync(enqueueMailSync, connection));
    logger.info(
      { provider: connection.provider, connectionId: connection.id, needsAccountChoice, queued },
      "Integration connected",
    );
    return redirectWithin(
      baseUrl,
      returnPath(target, needsAccountChoice ? "vybrat-ucet" : "ok", provider),
    );
  } catch (error) {
    if (error instanceof ConnectionFlowError) {
      logger.warn(
        { provider, code: error.code, detail: error.detail },
        "Integration connection failed",
      );
      return redirectWithin(baseUrl, returnPath(target, FAILURES[error.code], provider));
    }
    throw error;
  }
}
