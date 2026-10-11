import type { InvoiceFilter, InvoiceRow, InvoiceSort } from "@bystro/core";

/** Czech texts and address parameters of the Faktury screen. No I/O. */

/** "1 den", "3 dny", "12 dní". */
export function daysLabel(days: number): string {
  if (days === 1) return "1 den";
  return days >= 2 && days <= 4 ? `${days} dny` : `${days} dní`;
}

/** "1 faktura", "3 faktury", "8 faktur". */
export function invoiceCountLabel(count: number): string {
  if (count === 1) return "1 faktura";
  return count >= 2 && count <= 4 ? `${count} faktury` : `${count} faktur`;
}

/** Part of the Přehled sentence about invoices, e.g. "2 faktury jsou po splatnosti". */
export function overdueSentence(count: number): string {
  if (count === 0) return "faktury jsou v pořádku";
  if (count === 1) return "1 faktura je po splatnosti";
  return count <= 4 ? `${count} faktury jsou po splatnosti` : `${count} faktur je po splatnosti`;
}

export type InvoiceTone = "danger" | "neutral" | "success";

export function invoiceStatusLabel(
  row: Pick<InvoiceRow, "status" | "daysOverdue" | "daysUntilDue">,
): { label: string; tone: InvoiceTone } {
  switch (row.status) {
    case "overdue":
      return { label: `${daysLabel(row.daysOverdue)} po splatnosti`, tone: "danger" };
    case "due_soon":
      return {
        label:
          row.daysUntilDue <= 0
            ? "Splatná dnes"
            : row.daysUntilDue === 1
              ? "Splatná zítra"
              : `Splatná za ${daysLabel(row.daysUntilDue)}`,
        tone: "neutral",
      };
    case "open":
      return { label: "Čeká na platbu", tone: "neutral" };
    case "paid":
      return { label: "Zaplaceno", tone: "success" };
  }
}

/** Filters in the order of the screen, with their value in the address (`?stav=`). */
export const FILTER_OPTIONS: readonly { filter: InvoiceFilter; param: string; label: string }[] = [
  { filter: "all", param: "", label: "Vše" },
  { filter: "overdue", param: "po-splatnosti", label: "Po splatnosti" },
  { filter: "due_soon", param: "brzy-splatne", label: "Brzy splatné" },
  { filter: "pending", param: "ceka", label: "Čeká" },
  { filter: "paid", param: "zaplaceno", label: "Zaplaceno" },
];

/** Sortable columns with their value in the address (`?razeni=`). */
export const SORT_OPTIONS: readonly { sort: InvoiceSort; param: string; label: string }[] = [
  { sort: "number", param: "cislo", label: "Číslo" },
  { sort: "client", param: "klient", label: "Klient" },
  { sort: "amount", param: "castka", label: "Částka" },
  { sort: "due", param: "", label: "Splatnost" },
];

export function parseFilter(value: unknown): InvoiceFilter {
  return FILTER_OPTIONS.find((option) => option.param === value)?.filter ?? "all";
}

export function parseSort(value: unknown): InvoiceSort {
  return SORT_OPTIONS.find((option) => option.param === value)?.sort ?? "due";
}

/** Address of the list with the given filter, search and sort (defaults are left out). */
export function invoiceListHref(state: {
  filter: InvoiceFilter;
  sort: InvoiceSort;
  query: string;
}): string {
  const params = new URLSearchParams();
  const filter = FILTER_OPTIONS.find((option) => option.filter === state.filter)?.param ?? "";
  const sort = SORT_OPTIONS.find((option) => option.sort === state.sort)?.param ?? "";
  if (filter !== "") params.set("stav", filter);
  if (state.query !== "") params.set("q", state.query);
  if (sort !== "") params.set("razeni", sort);
  const search = params.toString();
  return search === "" ? "/app/faktury" : `/app/faktury?${search}`;
}

const quantityFormat = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 });

/** Quantity kept in thousandths, e.g. 1500 → "1,5". */
export function formatQuantity(quantityMilli: number): string {
  return quantityFormat.format(quantityMilli / 1000);
}
