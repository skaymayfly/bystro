import {
  formatCzk,
  formatMoney,
  sortInvoiceRows,
  type InvoiceRow,
  type InvoiceSummary,
} from "@bystro/core";
import Link from "next/link";

import { PanelEmpty } from "@/components/bits";
import { daysLabel, invoiceCountLabel } from "@/lib/invoice-labels";
import type { InvoicingSources } from "@/lib/invoicing-providers";

import { SourceNote } from "./invoice-bits";

const SHOWN = 3;

/**
 * Body of the "Po splatnosti" card on Přehled: how many invoices are overdue, how much
 * money that is and which is the oldest, with the source and the time of the last update.
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
  const { overdue, oldestOverdue } = summary;
  if (overdue.count === 0 || oldestOverdue === null) {
    return (
      <>
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
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-2xl font-semibold tracking-[-0.02em] text-danger-strong">
          {formatCzk(overdue.sumMinor)}
        </p>
        <p className="text-[13px] text-ink-3">
          {invoiceCountLabel(overdue.count)} · nejstarší {daysLabel(oldestOverdue.daysOverdue)} po
          splatnosti
        </p>
      </div>
      <ul className="flex flex-1 flex-col">
        {overdueRows.slice(0, SHOWN).map((row) => (
          <li key={row.id} className="border-t border-line-soft">
            <Link
              href={`/app/faktury/${row.id}`}
              className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-subtle"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {row.clientName ?? "Bez klienta"}
                </span>
                <span className="block text-xs text-ink-3">
                  {row.number} · {daysLabel(row.daysOverdue)} po splatnosti
                </span>
              </span>
              <span className="font-semibold whitespace-nowrap">
                {formatMoney(row.remainingMinor, row.currency)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {overdueRows.length > SHOWN && (
        <Link
          href="/app/faktury?stav=po-splatnosti"
          className="text-[13px] text-ink-3 hover:text-ink"
        >
          A další {invoiceCountLabel(overdueRows.length - SHOWN)}
        </Link>
      )}
      {note}
    </>
  );
}
