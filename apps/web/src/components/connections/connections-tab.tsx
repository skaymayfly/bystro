import { listConnections } from "@bystro/db";
import type { FakturoidAccount } from "@bystro/integrations";

import { SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { connectOutcomeNotice } from "@/lib/connection-status";
import { PROVIDERS } from "@/lib/content";
import { parseInvoicingProvider } from "@/lib/invoicing-providers";
import { cn } from "@/lib/utils";
import { ConnectionFlowError, listSelectableFakturoidAccounts } from "@/server/connections";
import { getDb } from "@/server/db";
import {
  getFakturoidFlow,
  getGmail,
  getIdoklad,
  toConnectionView,
  type ConnectionView,
} from "@/server/integrations";

import { ConnectionsList } from "./connections-list";
import { ProviderPicker, type ProviderState, type ProviderStates } from "./provider-picker";

const panelClass = "min-w-0 rounded-[18px] border border-line bg-card shadow-soft";

/**
 * Connections of a company, the invoicing systems among them, and which invoicing systems
 * can be connected in this environment.
 */
export async function loadConnections(organizationId: string) {
  const all = await listConnections(getDb(), organizationId);
  const connections = all
    .filter((connection) => connection.status !== "revoked")
    .map(toConnectionView);
  const invoicing = connections.filter(
    (connection) => parseInvoicingProvider(connection.provider) !== null,
  );
  const state = (provider: string, configured: boolean): ProviderState =>
    invoicing.some((connection) => connection.provider === provider)
      ? "connected"
      : configured
        ? "connect"
        : "unavailable";
  const fakturoidAvailable = getFakturoidFlow() !== null;
  const idokladAvailable = getIdoklad() !== null;
  const gmailAvailable = getGmail() !== null;
  const mailbox = connections.find((connection) => connection.provider === "gmail") ?? null;
  const states: ProviderStates = {
    fakturoid: state("fakturoid", fakturoidAvailable),
    idoklad: state("idoklad", idokladAvailable),
    gmail: mailbox !== null ? "connected" : gmailAvailable ? "connect" : "unavailable",
  };
  return {
    connections,
    invoicing,
    states,
    /** Some invoicing system can be connected here. */
    invoicingAvailable: fakturoidAvailable || idokladAvailable,
    /** The connected mailbox, if any. */
    mailbox,
    mailAvailable: gmailAvailable,
  };
}

/** The sentence shown after coming back from the provider. */
export function ConnectOutcomeNotice({
  outcome,
  provider,
}: {
  outcome: string | undefined;
  /** The `aplikace` query value: which application the outcome is about. */
  provider: string | undefined;
}) {
  const notice = connectOutcomeNotice(outcome, provider);
  if (notice === null) {
    return null;
  }
  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-box border px-4 py-3 text-sm leading-normal",
        notice.tone === "error"
          ? "border-danger/30 bg-danger-soft text-danger-strong"
          : "border-line-strong bg-card text-ink-2",
      )}
    >
      {notice.text}
    </p>
  );
}

async function selectableAccounts(connection: ConnectionView, organizationId: string) {
  const flow = getFakturoidFlow();
  if (flow === null || !connection.needsAccount) {
    return [];
  }
  try {
    return await listSelectableFakturoidAccounts(flow, {
      organizationId,
      connectionId: connection.id,
    });
  } catch (error) {
    if (error instanceof ConnectionFlowError) {
      return [];
    }
    throw error;
  }
}

function AccountChooser({
  connectionId,
  accounts,
}: {
  connectionId: string;
  accounts: readonly FakturoidAccount[];
}) {
  return (
    <section className={cn(panelClass, "flex w-full flex-col gap-3 p-[18px]")}>
      <div>
        <h2 className="text-[17px] font-medium">Který účet mám číst?</h2>
        <p className="mt-[3px] text-sm text-ink-3">
          U Fakturoidu máš přístup k více účtům. Vyber ten, který patří k téhle firmě.
        </p>
      </div>
      {accounts.length === 0 ? (
        <p className="text-sm text-ink-3">
          Účty se teď nepodařilo načíst. Zkus stránku za chvíli obnovit.
        </p>
      ) : (
        <form
          method="post"
          action={`/api/integrations/connections/${connectionId}/account`}
          className="flex flex-wrap gap-2"
        >
          {accounts.map((account) => (
            <Button
              key={account.slug}
              type="submit"
              name="slug"
              value={account.slug}
              variant="outline"
            >
              {account.name}
              {account.registrationNo !== null && (
                <span className="text-ink-3">IČO {account.registrationNo}</span>
              )}
            </Button>
          ))}
        </form>
      )}
    </section>
  );
}

/** Nastavení → Propojení: add an app on the left, connected apps with their state on the right. */
export async function ConnectionsTab({
  organizationId,
  outcome,
  provider,
}: {
  organizationId: string;
  outcome: string | undefined;
  provider: string | undefined;
}) {
  const { connections, states, invoicingAvailable, mailAvailable } =
    await loadConnections(organizationId);
  // Only Fakturoid lets one user into several accounts; at iDoklad the user picks the
  // company while signing in.
  const fakturoid = connections.find((connection) => connection.provider === "fakturoid") ?? null;
  const accounts = fakturoid === null ? [] : await selectableAccounts(fakturoid, organizationId);

  return (
    <>
      <ConnectOutcomeNotice outcome={outcome} provider={provider} />
      {fakturoid?.needsAccount === true && (
        <AccountChooser connectionId={fakturoid.id} accounts={accounts} />
      )}
      <div className="flex flex-wrap items-start gap-3.5">
        <section
          className={cn(
            panelClass,
            "flex max-w-[420px] flex-[1_1_320px] flex-col gap-3.5 p-[18px]",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-[17px] font-medium">Přidat aplikaci</h2>
              <p className="mt-[3px] text-sm text-ink-3">
                Faktury jen čtu. E-mail pošlu jen ten, který odešleš nebo schválíš.
              </p>
            </div>
            {!invoicingAvailable && !mailAvailable && <SoonBadge />}
          </div>
          <ProviderPicker states={states} returnTo="settings" className="grid-cols-5" />
          {(invoicingAvailable || mailAvailable) && (
            <p className="text-xs text-ink-3">Ostatní aplikace teprve chystáme.</p>
          )}
        </section>
        <section className={cn(panelClass, "flex-[2_1_360px] overflow-hidden")}>
          <div className="flex items-baseline justify-between border-b border-line-soft px-[18px] py-4">
            <h2 className="text-[17px] font-medium">Propojené aplikace</h2>
            <p className="text-[13px] text-ink-3">
              {connections.length} z {PROVIDERS.length}
            </p>
          </div>
          <ConnectionsList initial={connections} returnTo="settings" />
        </section>
      </div>
    </>
  );
}
