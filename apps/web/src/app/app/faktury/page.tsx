import {
  filterInvoiceRows,
  formatCzk,
  formatDate,
  formatMoney,
  sortInvoiceRows,
  type InvoiceFilter,
} from "@bystro/core";
import { ChevronRight, FileText, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, PageHeader, ScreenEmpty } from "@/components/bits";
import { loadConnections } from "@/components/connections/connections-tab";
import { InvoicingCta } from "@/components/connections/invoicing-cta";
import { SourceNote, StatusPill } from "@/components/invoices/invoice-bits";
import {
  FILTER_OPTIONS,
  invoiceCountLabel,
  invoiceListHref,
  invoiceStatusLabel,
  parseFilter,
  parseSort,
  SORT_OPTIONS,
} from "@/lib/invoice-labels";
import { initials } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { requireRequestContext } from "@/server/context";
import { loadInvoiceOverview } from "@/server/invoices";

export const metadata: Metadata = { title: "Faktury – Bystro" };

const ROW_GRID =
  "grid grid-cols-[130px_minmax(0,1.6fr)_1fr_1fr_190px_24px] items-center gap-3 px-4";

interface Stat {
  filter: InvoiceFilter;
  label: string;
  dot: string;
  border: string;
  sum: bigint;
  count: number;
}

/** Faktury: the prototype's list with sums, filters, search and sorting. */
export default async function InvoicesPage(props: PageProps<"/app/faktury">) {
  const { organization } = await requireRequestContext();
  const { fakturoid, fakturoidAvailable } =
    organization === null
      ? { fakturoid: null, fakturoidAvailable: false }
      : await loadConnections(organization.id);

  if (organization === null || fakturoid === null) {
    return (
      <div className="flex flex-col gap-[22px]">
        <PageHeader title="Faktury" text="Fakturace není propojená" />
        <ScreenEmpty
          icon={<FileText aria-hidden size={28} strokeWidth={1.6} />}
          title="Zatím tu žádné faktury nejsou"
          text="Propoj svůj fakturační systém. Načtu faktury za poslední rok a začnu hlídat splatnosti."
        >
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <InvoicingCta available={fakturoidAvailable} />
          </div>
        </ScreenEmpty>
      </div>
    );
  }

  const now = new Date();
  const { rows, summary } = await loadInvoiceOverview(organization.id, now);

  if (rows.length === 0) {
    const loading = fakturoid.lastSyncAt === null;
    return (
      <div className="flex flex-col gap-[22px]">
        <PageHeader title="Faktury" text="Fakturoid je propojený" />
        <ScreenEmpty
          icon={<FileText aria-hidden size={28} strokeWidth={1.6} />}
          title={loading ? "Faktury se načítají" : "Ve Fakturoidu zatím žádné faktury nevidím"}
          text={
            loading
              ? "Fakturoid je propojený a faktury z něj právě stahuju. Za chvíli stránku obnov."
              : "Načítám faktury vystavené za poslední rok. Jakmile nějakou vystavíš, do hodiny se tu objeví."
          }
        />
        <SourceNote lastSyncAt={fakturoid.lastSyncAt} now={now} />
      </div>
    );
  }

  const query = await props.searchParams;
  const filter = parseFilter(query.stav);
  const sort = parseSort(query.razeni);
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const state = { filter, sort, query: search };
  const visible = sortInvoiceRows(filterInvoiceRows(rows, { filter, query: search }), sort);

  const stats: Stat[] = [
    {
      filter: "overdue",
      label: "Po splatnosti",
      dot: "bg-danger",
      border: "border-danger",
      sum: summary.overdue.sumMinor,
      count: summary.overdue.count,
    },
    {
      filter: "pending",
      label: "Čeká na platbu",
      dot: "bg-ink",
      border: "border-ink",
      sum: summary.pending.sumMinor,
      count: summary.pending.count,
    },
    {
      filter: "paid",
      label: "Zaplaceno",
      dot: "bg-success",
      border: "border-success",
      sum: summary.paid.sumMinor,
      count: summary.paid.count,
    },
  ];
  const waiting = summary.overdue.sumMinor + summary.pending.sumMinor;
  const activeFilterParam = FILTER_OPTIONS.find((option) => option.filter === filter)?.param ?? "";
  const activeSortParam = SORT_OPTIONS.find((option) => option.sort === sort)?.param ?? "";

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        title="Faktury"
        text={`${invoiceCountLabel(rows.length)} · ${formatCzk(waiting)} čeká na zaplacení`}
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3.5">
        {stats.map((stat) => (
          <Link
            key={stat.filter}
            // Clicking the active card again shows everything, as in the prototype.
            href={invoiceListHref({
              ...state,
              filter: filter === stat.filter ? "all" : stat.filter,
            })}
            aria-current={filter === stat.filter ? "true" : undefined}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-card border bg-card px-6 py-[22px] transition-colors hover:bg-subtle",
              filter === stat.filter ? stat.border : "border-line",
            )}
          >
            <span className="flex items-center gap-2 text-sm text-ink-3">
              <span aria-hidden className={cn("size-2 rounded-full", stat.dot)} />
              {stat.label}
            </span>
            <span className="text-[30px] leading-tight font-semibold tracking-[-0.035em]">
              {formatCzk(stat.sum)}
            </span>
            <span className="text-[13px] text-ink-3">{invoiceCountLabel(stat.count)}</span>
          </Link>
        ))}
      </div>

      <Card className="gap-2.5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-1 pb-2">
          <nav
            aria-label="Filtr faktur"
            className="flex flex-wrap rounded-[26px] border border-line-soft bg-card p-[5px]"
          >
            {FILTER_OPTIONS.map((option) => (
              <Link
                key={option.filter}
                href={invoiceListHref({ ...state, filter: option.filter })}
                aria-current={filter === option.filter ? "page" : undefined}
                className={cn(
                  "rounded-full px-[18px] py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  filter === option.filter ? "bg-ink text-white" : "text-ink-3 hover:text-ink",
                )}
              >
                {option.label}
              </Link>
            ))}
          </nav>
          <form
            action="/app/faktury"
            role="search"
            className="flex h-[46px] w-[280px] max-w-full items-center gap-2.5 rounded-full border border-line-strong bg-card px-4 text-ink-3 focus-within:border-ink-2"
          >
            <Search aria-hidden size={16} strokeWidth={1.7} className="flex-none" />
            {activeFilterParam !== "" && (
              <input type="hidden" name="stav" value={activeFilterParam} />
            )}
            {activeSortParam !== "" && (
              <input type="hidden" name="razeni" value={activeSortParam} />
            )}
            <input
              type="search"
              name="q"
              defaultValue={search}
              aria-label="Hledat klienta nebo číslo"
              placeholder="Hledat klienta nebo číslo"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
            />
          </form>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div
              className={cn(ROW_GRID, "py-2.5 text-xs font-medium tracking-[0.02em] text-ink-3")}
            >
              {SORT_OPTIONS.map((option) => (
                <Link
                  key={option.sort}
                  href={invoiceListHref({ ...state, sort: option.sort })}
                  aria-label={`Seřadit podle: ${option.label}`}
                  className={cn(
                    "uppercase hover:text-ink",
                    option.sort === "amount" && "text-right",
                    sort === option.sort && "text-ink",
                  )}
                >
                  {option.label}
                  {sort === option.sort && <span aria-hidden> ↓</span>}
                </Link>
              ))}
              <span className="uppercase">Stav</span>
              <span />
            </div>
            <ul aria-label="Faktury">
              {visible.map((row) => {
                const status = invoiceStatusLabel(row);
                return (
                  <li key={row.id} className="border-t border-line-soft">
                    <Link
                      href={`/app/faktury/${row.id}`}
                      className={cn(ROW_GRID, "rounded-tile py-3.5 text-sm hover:bg-muted")}
                    >
                      <span className="text-ink-3">{row.number}</span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          aria-hidden
                          className="inline-flex size-8 flex-none items-center justify-center rounded-full bg-line-soft text-[11px] font-bold text-ink-2"
                        >
                          {initials(row.clientName ?? "")}
                        </span>
                        <span className="truncate font-medium">
                          {row.clientName ?? "Bez klienta"}
                        </span>
                      </span>
                      <span className="text-right font-semibold">
                        {formatMoney(row.totalMinor, row.currency)}
                      </span>
                      <span className="text-ink-2">{formatDate(row.dueOn)}</span>
                      <span>
                        <StatusPill label={status.label} tone={status.tone} />
                      </span>
                      <ChevronRight aria-hidden size={16} className="text-ink-4" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {visible.length === 0 && (
              <p className="p-12 text-center text-[15px] text-ink-3">
                Nic jsem nenašel. Zkus jiný filtr nebo hledaný výraz.
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-1">
        <SourceNote lastSyncAt={fakturoid.lastSyncAt} now={now} />
        {summary.otherCurrencyCount > 0 && (
          <p className="text-xs text-ink-3">
            {invoiceCountLabel(summary.otherCurrencyCount)} v jiné měně do součtů v korunách
            nepočítám.
          </p>
        )}
      </div>
    </div>
  );
}
