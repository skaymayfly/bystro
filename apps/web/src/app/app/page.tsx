import { formatDate, formatWeekday } from "@bystro/core";
import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PanelEmpty, SoonBadge } from "@/components/bits";
import { loadConnections } from "@/components/connections/connections-tab";
import { InvoicingCta } from "@/components/connections/invoicing-cta";
import { OverduePanel } from "@/components/invoices/overdue-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { overdueSentence } from "@/lib/invoice-labels";
import { describeInvoicingSources } from "@/lib/invoicing-providers";
import { requireRequestContext } from "@/server/context";
import { loadInvoiceOverview } from "@/server/invoices";

export const metadata: Metadata = { title: "Přehled – Bystro" };

const detailLinkClass = "text-[13px] text-link hover:text-link-hover";

/**
 * Přehled with nothing connected yet. The prototype only draws it full of data, so the
 * panels keep its layout and each says what is missing.
 */
export default async function DashboardPage() {
  const { organization } = await requireRequestContext();
  const now = new Date();
  const { invoicing, invoicingAvailable, mailbox, mailAvailable } =
    organization === null
      ? { invoicing: [], invoicingAvailable: false, mailbox: null, mailAvailable: false }
      : await loadConnections(organization.id);
  const sources = describeInvoicingSources(invoicing);
  const invoices =
    organization === null || sources === null
      ? null
      : await loadInvoiceOverview(organization.id, now);

  return (
    <div className="flex max-w-[1240px] flex-col">
      <p className="flex items-center gap-2 pt-3 text-[13px] text-ink-3">
        <Building2 aria-hidden size={14} strokeWidth={1.7} />
        {organization?.name} · {formatWeekday(now)} {formatDate(now, "long")}
      </p>
      <h1 className="mt-2.5 text-[30px] font-semibold tracking-[-0.025em]">Přehled</h1>
      <p className="mt-2 text-base leading-normal text-ink-3">
        E-mail zatím nevidím,{" "}
        {invoices === null ? "faktury nevidím" : overdueSentence(invoices.summary.overdue.count)} a
        banku taky ne.
      </p>

      <div className="mt-7 flex flex-wrap items-stretch gap-4">
        <Panel
          title="Hlídač peněz"
          className="flex-[2_1_560px]"
          aside={
            <Link href="/app/hlidac-penez" className={detailLinkClass}>
              Zobrazit vše
            </Link>
          }
        >
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold tracking-[-0.02em] text-ink-4">—</p>
            <p className="text-[13px] text-ink-3">Zůstatek na účtech dnes</p>
          </div>
          <PanelEmpty
            title="Propoj banku a uvidíš, kolik ti zbude za 30, 60 a 90 dní"
            text="Přístup je jen pro čtení. Peníze z účtu nikdy nepohnu."
          >
            <Button size="sm" disabled>
              Připojit banku
            </Button>
            <SoonBadge />
          </PanelEmpty>
        </Panel>

        <Panel title="Dnešní schůzky" className="flex-[1_1_340px]" aside={<SoonBadge />}>
          <PanelEmpty
            title="Kalendář zatím není propojený"
            text="Až ho připojíš, uvidíš tu dnešní program."
          />
        </Panel>
      </div>

      <div className="mt-4 flex flex-wrap items-stretch gap-4">
        <Panel
          title="Po splatnosti"
          className="flex-[1_1_340px]"
          aside={
            <Link href="/app/faktury" className={detailLinkClass}>
              Zobrazit vše
            </Link>
          }
        >
          {sources === null || invoices === null ? (
            <PanelEmpty
              title="Faktury zatím nevidím"
              text="Propoj Fakturoid, iDoklad nebo Pohodu a pohlídám ti splatnosti."
            >
              <InvoicingCta available={invoicingAvailable} size="sm" />
            </PanelEmpty>
          ) : (
            <OverduePanel
              rows={invoices.rows}
              summary={invoices.summary}
              sources={sources}
              now={now}
            />
          )}
        </Panel>

        <Panel title="Odpovědět" className="flex-[1_1_340px]">
          {mailbox !== null ? (
            <PanelEmpty
              title="Schránka je propojená"
              text="Kdo čeká na odpověď, ti tu ukážu, jakmile načtu poštu."
            />
          ) : (
            <PanelEmpty
              title="E-mail zatím není propojený"
              text="Připoj schránku a každé ráno ti řeknu, kdo čeká na odpověď."
            >
              {mailAvailable ? (
                <Link href="/app/posta" className={buttonVariants({ size: "sm" })}>
                  Připojit e-mail
                </Link>
              ) : (
                <>
                  <Button size="sm" disabled>
                    Připojit e-mail
                  </Button>
                  <SoonBadge />
                </>
              )}
            </PanelEmpty>
          )}
        </Panel>
      </div>
    </div>
  );
}
