import { Check, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, PageHeader, Panel, PanelEmpty, SoonBadge } from "@/components/bits";
import { loadConnections } from "@/components/connections/connections-tab";
import { InvoicingCta } from "@/components/connections/invoicing-cta";
import { BigFigure, OverduePanel } from "@/components/invoices/overdue-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { overdueSentence } from "@/lib/invoice-labels";
import { describeInvoicingSources } from "@/lib/invoicing-providers";
import { cn } from "@/lib/utils";
import { requireRequestContext } from "@/server/context";
import { loadInvoiceOverview } from "@/server/invoices";

export const metadata: Metadata = { title: "Přehled – Bystro" };

const detailLinkClass = "text-[13px] font-medium text-link hover:text-link-hover";

interface SetupStep {
  label: string;
  text: string;
  done: boolean;
  /** Where to finish the step; `null` when it cannot be done yet. */
  href: string | null;
}

/** A ring that fills with the share of finished steps, as Revolut's "Finish account setup". */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 15;
  const length = 2 * Math.PI * radius;
  return (
    <span className="relative flex size-10 flex-none items-center justify-center">
      <svg viewBox="0 0 36 36" aria-hidden className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3" className="stroke-chip" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - done / total)}
          className="stroke-cta"
        />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}

/** "Dokonči nastavení": what is connected and what is left, each with a way to finish it. */
function SetupWidget({ steps }: { steps: readonly SetupStep[] }) {
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done && step.href !== null);
  return (
    <Card className="gap-4 px-5 py-[18px]">
      <div className="flex items-center gap-3">
        <ProgressRing done={done} total={steps.length} />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Dokonči nastavení</h2>
          <p className="text-[13px] leading-snug text-ink-3">
            Čím víc propojíš, tím víc toho pohlídám.
          </p>
        </div>
      </div>
      <ul className="-mx-2 flex flex-col">
        {steps.map((step) => {
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-6 flex-none items-center justify-center rounded-full",
                  step.done ? "bg-success-soft text-success-strong" : "border border-line-strong",
                )}
              >
                {step.done && <Check size={13} strokeWidth={2.4} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", step.done && "text-ink-3")}>
                  {step.label}
                </span>
                <span className="block text-xs text-ink-3">{step.done ? "Hotovo" : step.text}</span>
              </span>
            </>
          );
          return (
            <li key={step.label}>
              {!step.done && step.href !== null ? (
                <Link
                  href={step.href}
                  className="flex items-center gap-3 rounded-control px-2 py-2 transition-colors hover:bg-chip"
                >
                  {body}
                  <ChevronRight aria-hidden size={16} className="text-ink-4" />
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-2 py-2">
                  {body}
                  {!step.done && <SoonBadge />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {next !== undefined && next.href !== null && (
        <Link href={next.href} className={buttonVariants({ className: "h-10 w-full" })}>
          Pokračovat v nastavení
        </Link>
      )}
    </Card>
  );
}

/**
 * Přehled laid out as the Revolut Business home: the main column with the invoices card and
 * the money watch, a column of widgets on the right. Every figure names its source.
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

  const steps: SetupStep[] = [
    { label: "Firma", text: "Údaje z ARES", done: organization !== null, href: null },
    {
      label: "Fakturace",
      text: "Fakturoid nebo iDoklad",
      done: sources !== null,
      href: invoicingAvailable ? "/app/nastaveni?karta=propojeni" : null,
    },
    {
      label: "Schránka",
      text: "Gmail pro upomínky a odpovědi",
      done: mailbox !== null,
      href: mailAvailable ? "/app/posta" : null,
    },
    { label: "Banka", text: "Zůstatek a platby", done: false, href: null },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Přehled"
        text={`E-mail zatím nevidím, ${
          invoices === null ? "faktury nevidím" : overdueSentence(invoices.summary.overdue.count)
        } a banku taky ne.`}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="gap-5">
            {sources === null || invoices === null ? (
              <>
                <BigFigure label="Po splatnosti" value="—" tone="muted" />
                <PanelEmpty
                  title="Faktury zatím nevidím"
                  text="Propoj Fakturoid, iDoklad nebo Pohodu a pohlídám ti splatnosti."
                >
                  <InvoicingCta available={invoicingAvailable} size="sm" />
                </PanelEmpty>
              </>
            ) : (
              <OverduePanel
                rows={invoices.rows}
                summary={invoices.summary}
                sources={sources}
                now={now}
              />
            )}
          </Card>

          <Card className="gap-4">
            <BigFigure
              label="Zůstatek na účtech dnes"
              value="—"
              tone="muted"
              aside={
                <Link href="/app/hlidac-penez" className={detailLinkClass}>
                  Hlídač peněz
                </Link>
              }
            />
            <PanelEmpty
              title="Propoj banku a uvidíš, kolik ti zbude za 30, 60 a 90 dní"
              text="Přístup je jen pro čtení. Peníze z účtu nikdy nepohnu."
            >
              <Button size="sm" disabled>
                Připojit banku
              </Button>
              <SoonBadge />
            </PanelEmpty>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <SetupWidget steps={steps} />

          <Panel title="Odpovědět">
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

          <Panel title="Dnešní schůzky" aside={<SoonBadge />}>
            <PanelEmpty
              title="Kalendář zatím není propojený"
              text="Až ho připojíš, uvidíš tu dnešní program."
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
