import { listConnections } from "@bystro/db";
import type { FakturoidAccount } from "@bystro/integrations";

import { SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { CONNECT_OUTCOME_TEXTS } from "@/lib/connection-status";
import { PROVIDERS } from "@/lib/content";
import { cn } from "@/lib/utils";
import { ConnectionFlowError, listSelectableFakturoidAccounts } from "@/server/connections";
import { getDb } from "@/server/db";
import { getFakturoidFlow, toConnectionView, type ConnectionView } from "@/server/integrations";

import { ConnectionsList } from "./connections-list";
import { ProviderPicker, type FakturoidState } from "./provider-picker";

const panelClass = "min-w-0 rounded-[18px] border border-line bg-card shadow-soft";

/** Connections of a company and whether Fakturoid can be connected in this environment. */
export async function loadConnections(organizationId: string) {
  const all = await listConnections(getDb(), organizationId);
  const connections = all
    .filter((connection) => connection.status !== "revoked")
    .map(toConnectionView);
  const fakturoid = connections.find((connection) => connection.provider === "fakturoid") ?? null;
  const fakturoidAvailable = getFakturoidFlow() !== null;
  const fakturoidState: FakturoidState =
    fakturoid !== null ? "connected" : fakturoidAvailable ? "connect" : "unavailable";
  return { connections, fakturoid, fakturoidAvailable, fakturoidState };
}

/** The sentence shown after coming back from the provider. */
export function ConnectOutcomeNotice({ outcome }: { outcome: string | undefined }) {
  const notice = outcome === undefined ? undefined : CONNECT_OUTCOME_TEXTS[outcome];
  if (notice === undefined) {
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
}: {
  organizationId: string;
  outcome: string | undefined;
}) {
  const { connections, fakturoid, fakturoidAvailable, fakturoidState } =
    await loadConnections(organizationId);
  const accounts = fakturoid === null ? [] : await selectableAccounts(fakturoid, organizationId);

  return (
    <>
      <ConnectOutcomeNotice outcome={outcome} />
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
              <p className="mt-[3px] text-sm text-ink-3">Přístup je vždy jen pro čtení.</p>
            </div>
            {!fakturoidAvailable && <SoonBadge />}
          </div>
          <ProviderPicker fakturoid={fakturoidState} returnTo="settings" className="grid-cols-5" />
          {fakturoidAvailable && (
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
