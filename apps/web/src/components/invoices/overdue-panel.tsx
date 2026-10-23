import {
  formatCzk,
  formatMoney,
  sortInvoiceRows,
  type InvoiceRow,
  type InvoiceSummary,
} from "@bystro/core";
import Link from "next/link";
import type { ReactNode } from "react";

import { PanelEmpty } from "@/components/bits";
import { buttonVariants } from "@/components/ui/button";
import { daysLabel, invoiceCountLabel } from "@/lib/invoice-labels";
import type { InvoicingSources } from "@/lib/invoicing-providers";
import { initials } from "@/lib/navigation";

import { SourceNote, StatusPill } from "./invoice-bits";

const SHOWN = 4;

/**
 * Body of the main card on Přehled, laid out as the balance card of Revolut Business: the
 * overdue sum as the big figure, how many invoices and the oldest under it, then the overdue
 * invoices as table rows. The source and the time of the last update close the card.
 */
export function OverduePanel({
  rows,
  summary,
  sources,
  now,
}: {
  rows: readonly InvoiceRow[];
  summary: InvoiceSummary;
  /** The connected invoicing systems the figures come from. */
  sources: InvoicingSources;
  now: Date;
}) {
  const note = <SourceNote source={sources.names} lastSyncAt={sources.lastSyncAt} now={now} />;
  const { overdue, oldestOverdue, pending } = summary;
  const allInvoices = (
    <Link href="/app/faktury" className={buttonVariants({ variant: "secondary", size: "sm" })}>
      Všechny faktury
    </Link>
  );

  if (overdue.count === 0 || oldestOverdue === null) {
    return (
      <>
        <BigFigure label="Po splatnosti" value={formatCzk(0)} aside={allInvoices} />
        <PanelEmpty
          title="Nic po splatnosti"
          text={
            rows.length === 0
              ? `${sources.inside} zatím žádné faktury nevidím.`
              : "Všechny faktury jsou zaplacené nebo v termínu."
          }
        />
        {note}
      </>
    );
  }

  const overdueRows = sortInvoiceRows(rows.filter((row) => row.status === "overdue"));
  return (
    <>
      <BigFigure
        label="Po splatnosti"
        value={formatCzk(overdue.sumMinor)}
        tone="danger"
        text={`${invoiceCountLabel(overdue.count)} · nejstarší ${daysLabel(oldestOverdue.daysOverdue)} po splatnosti`}
        aside={allInvoices}
      />
      {pending.count > 0 && (
        <p className="-mt-1 text-[13px] text-ink-3">
          V termínu čeká ještě {formatCzk(pending.sumMinor)}
        </p>
      )}

      <div>
        <div
          aria-hidden
          className="label-mono grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-line-soft pb-2.5 sm:grid-cols-[minmax(0,1fr)_150px_120px]"
        >
          <span>Klient</span>
          <span className="hidden sm:block">Stav</span>
          <span className="text-right">Zbývá</span>
        </div>
        <ul className="flex flex-col">
          {overdueRows.slice(0, SHOWN).map((row) => (
            <li key={row.id}>
              <Link
                href={`/app/faktury/${row.id}`}
                className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-control px-2 py-2.5 text-sm transition-colors hover:bg-chip sm:grid-cols-[minmax(0,1fr)_150px_120px]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 flex-none items-center justify-center rounded-full bg-danger-soft text-xs font-semibold text-danger-strong"
                  >
                    {initials(row.clientName ?? "?")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {row.clientName ?? "Bez klienta"}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {row.number}
                      <span className="sm:hidden">
                        {" "}
                        · {daysLabel(row.daysOverdue)} po splatnosti
                      </span>
                    </span>
                  </span>
                </span>
                <span className="hidden sm:block">
                  <StatusPill tone="danger" label={`${daysLabel(row.daysOverdue)} po splatnosti`} />
                </span>
                <span className="text-right font-semibold whitespace-nowrap tabular-nums">
                  {formatMoney(row.remainingMinor, row.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
        {note}
        {overdueRows.length > SHOWN && (
          <Link
            href="/app/faktury?stav=po-splatnosti"
            className="text-[13px] font-medium text-link hover:text-link-hover"
          >
            A další {invoiceCountLabel(overdueRows.length - SHOWN)}
          </Link>
        )}
      </div>
    </>
  );
}

/** The large figure at the top of a card with its label, as Revolut shows a balance. */
export function BigFigure({
  label,
  value,
  text,
  tone = "default",
  aside,
}: {
  label: string;
  value: string;
  text?: string;
  tone?: "default" | "danger" | "muted";
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink-3">{label}</p>
        <p
          className={
            tone === "danger"
              ? "mt-1 text-[34px] leading-none font-semibold tracking-[-0.03em] text-danger-strong tabular-nums"
              : tone === "muted"
                ? "mt-1 text-[34px] leading-none font-semibold tracking-[-0.03em] text-ink-4"
                : "mt-1 text-[34px] leading-none font-semibold tracking-[-0.03em] tabular-nums"
          }
        >
          {value}
        </p>
        {text !== undefined && <p className="mt-2 text-[13px] text-ink-3">{text}</p>}
      </div>
      {aside !== undefined && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}
