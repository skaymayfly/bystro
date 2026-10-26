import {
  buildInvoiceRows,
  formatDate,
  formatMoney,
  reminderSubject,
  reminderText,
  todayInPrague,
  type DateOnly,
} from "@bystro/core";
import { getInvoiceDetail, listMailCorrespondents } from "@bystro/db";
import { ChevronLeft, History, ListOrdered } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/bits";
import { loadConnections } from "@/components/connections/connections-tab";
import { SourceNote, StatusPill } from "@/components/invoices/invoice-bits";
import { ReminderCard } from "@/components/invoices/reminder-card";
import { formatQuantity, invoiceStatusLabel, type InvoiceTone } from "@/lib/invoice-labels";
import { providerWording } from "@/lib/invoicing-providers";
import { cn } from "@/lib/utils";
import { requireRequestContext } from "@/server/context";
import { getDb } from "@/server/db";
import { findMailbox } from "@/server/mail";
import { loadReminderState, recipientSuggestions } from "@/server/reminders";

export const metadata: Metadata = { title: "Faktura – Bystro" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-tile bg-muted px-4 py-3.5">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-[3px] font-medium break-words">{value}</p>
    </div>
  );
}

interface TimelineEvent {
  on: DateOnly;
  title: string;
  /** Things that already happened are solid; the due date ahead is hollow. */
  done: boolean;
}

/**
 * Detail of one invoice, as in the prototype. An overdue invoice has the reminder card;
 * Bystro never changes anything in the invoicing system itself.
 */
export default async function InvoiceDetailPage(props: PageProps<"/app/faktury/[id]">) {
  const { organization, user, role } = await requireRequestContext();
  const { id } = await props.params;
  if (organization === null || !UUID.test(id)) {
    notFound();
  }
  // Looked up together with the company: an invoice of another company is "not found".
  const detail = await getInvoiceDetail(getDb(), organization.id, id);
  if (detail === null) {
    notFound();
  }
  const { invoice, company, lines, payments } = detail;
  const now = new Date();
  const today = todayInPrague(now);
  // The note names the system this very invoice came from.
  const { invoicing } = await loadConnections(organization.id);
  const origin = invoicing.find((connection) => connection.provider === invoice.source) ?? null;

  const paidMinor = payments
    .filter((payment) => payment.currency === invoice.currency)
    .reduce((sum, payment) => sum + payment.amountMinor, 0n);
  const [row] = buildInvoiceRows(
    [
      {
        id: invoice.id,
        number: invoice.number,
        kind: invoice.kind,
        sourceStatus: invoice.sourceStatus,
        issuedOn: invoice.issuedOn as DateOnly,
        dueOn: invoice.dueOn as DateOnly,
        paidOn: invoice.paidOn as DateOnly | null,
        currency: invoice.currency,
        totalMinor: invoice.totalMinor,
        paidMinor,
        clientName: company?.name ?? null,
      },
    ],
    today,
  );
  const db = getDb();
  const reminders = await loadReminderState(db, organization.id, invoice.id);
  const remindedOn = reminders.sent
    .map((action) => (action.executedAt === null ? null : todayInPrague(action.executedAt)))
    .filter((on): on is DateOnly => on !== null);
  const overdue = row?.status === "overdue";
  // Drafts and cancelled invoices are not listed, but a direct link may still lead here.
  const status: { label: string; tone: InvoiceTone } =
    row === undefined
      ? { label: invoice.sourceStatus === "draft" ? "Koncept" : "Stornováno", tone: "neutral" }
      : invoiceStatusLabel(row, {
          reminded: remindedOn.some((on) => on >= (invoice.dueOn as DateOnly)),
        });
  const mailbox = overdue ? await findMailbox(db, organization.id) : null;
  const suggestions =
    overdue && mailbox !== null
      ? recipientSuggestions(
          company === null ? null : { name: company.name, email: company.email },
          await listMailCorrespondents(db, organization.id),
        )
      : [];
  const reminderTexts = (tone: "formal" | "soft") =>
    reminderText({
      tone,
      invoiceNumber: invoice.number,
      amount: formatMoney(row?.remainingMinor ?? invoice.totalMinor, invoice.currency),
      dueOn: formatDate(invoice.dueOn as DateOnly),
      senderName: user.name,
    });
  const proposedTo = reminders.open?.preview.to;
  const defaultTo =
    Array.isArray(proposedTo) && proposedTo.length > 0
      ? (proposedTo as { name: string | null; address: string }[])
          .map((person) =>
            person.name === null ? person.address : `${person.name} <${person.address}>`,
          )
          .join(", ")
      : company?.email === null || company?.email === undefined
        ? ""
        : `${company.name} <${company.email}>`;
  const paid = row?.status === "paid";
  const money = (amountMinor: bigint) => formatMoney(amountMinor, invoice.currency);

  const events: TimelineEvent[] = [
    { on: invoice.issuedOn as DateOnly, title: "Faktura vystavena", done: true },
    ...payments.map((payment) => ({
      on: payment.paidOn as DateOnly,
      title: `Přijata platba ${formatMoney(payment.amountMinor, payment.currency)}`,
      done: true,
    })),
  ];
  if (!paid && row !== undefined) {
    events.push({
      on: invoice.dueOn as DateOnly,
      title: row.status === "overdue" ? "Splatnost vypršela" : "Splatnost",
      done: row.status === "overdue",
    });
  }
  for (const on of remindedOn) {
    events.push({ on, title: "Připomenuto", done: true });
  }
  if (paid && invoice.paidOn !== null) {
    events.push({ on: invoice.paidOn as DateOnly, title: "Zaplaceno", done: true });
  }
  events.sort((a, b) => a.on.localeCompare(b.on));

  return (
    <div className="flex flex-col gap-[22px]">
      <header className="flex flex-col gap-3 pt-[18px]">
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Link href="/app/faktury" className="flex items-center gap-1 hover:text-ink">
            <ChevronLeft aria-hidden size={14} />
            Faktury
          </Link>
          <span aria-hidden>/</span>
          <span className="text-ink">{invoice.number}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="text-[clamp(34px,3.4vw,46px)] leading-[1.05] font-medium tracking-[-0.035em]">
            {company?.name ?? "Bez klienta"}
          </h1>
          <StatusPill
            label={status.label}
            tone={status.tone}
            className="px-[13px] py-[7px] text-[13px]"
          />
        </div>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-3.5">
        <div className="flex flex-col gap-3.5">
          <Card>
            <div>
              <p className="text-sm text-ink-3">{paid ? "Zaplacená částka" : "Částka k úhradě"}</p>
              <p className="mt-1.5 text-[clamp(40px,3.8vw,54px)] leading-[1.05] font-semibold tracking-[-0.045em]">
                {money(paid || row === undefined ? invoice.totalMinor : row.remainingMinor)}
              </p>
              {!paid && paidMinor > 0n && (
                <p className="mt-2 text-sm text-ink-3">
                  Z {money(invoice.totalMinor)} už přišlo {money(paidMinor)}.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Fact label="Vystaveno" value={formatDate(invoice.issuedOn as DateOnly)} />
              <Fact label="Splatnost" value={formatDate(invoice.dueOn as DateOnly)} />
              <Fact label="Variabilní symbol" value={invoice.variableSymbol ?? "—"} />
              <Fact label="Kontakt" value={company?.email ?? company?.phone ?? "—"} />
            </div>
          </Card>

          {overdue && (
            <ReminderCard
              invoiceId={invoice.id}
              proposed={reminders.open?.status === "proposed"}
              sending={
                reminders.open?.status === "approved" || reminders.open?.status === "executing"
              }
              hasMailbox={mailbox !== null}
              canSend={role === "owner" || role === "admin"}
              defaultTo={defaultTo}
              suggestions={suggestions}
              subject={reminderSubject(invoice.number)}
              texts={{ formal: reminderTexts("formal"), soft: reminderTexts("soft") }}
            />
          )}

          {lines.length > 0 && (
            <Card className="gap-1.5">
              <h2 className="flex items-center gap-2.5 pb-2.5 text-lg font-medium tracking-[-0.01em]">
                <ListOrdered aria-hidden size={18} strokeWidth={1.7} />
                Položky
              </h2>
              <ul>
                {lines.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-baseline justify-between gap-4 border-t border-line py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium break-words">{line.description}</p>
                      {line.quantityMilli !== null && line.unitPriceMinor !== null && (
                        <p className="text-[13px] text-ink-3">
                          {formatQuantity(line.quantityMilli)}
                          {line.unit !== null && ` ${line.unit}`} × {money(line.unitPriceMinor)}
                          {line.vatRateBasisPoints !== null &&
                            ` · DPH ${formatQuantity(line.vatRateBasisPoints * 10)} %`}
                        </p>
                      )}
                    </div>
                    <p className="text-[15px] font-semibold whitespace-nowrap">
                      {money(line.totalMinor)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="gap-1.5">
          <h2 className="flex items-center gap-2.5 pb-2.5 text-lg font-medium tracking-[-0.01em]">
            <History aria-hidden size={18} strokeWidth={1.7} />
            Historie
          </h2>
          <ol>
            {events.map((event, index) => (
              <li key={`${event.on}-${event.title}`} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2.5 rounded-full border-2",
                      event.done ? "border-ink bg-ink" : "border-line-dark bg-card",
                    )}
                  />
                  {index < events.length - 1 && (
                    <span aria-hidden className="w-px flex-1 bg-line" />
                  )}
                </div>
                <div className="pb-4">
                  <p className="text-[15px] font-medium">{event.title}</p>
                  <p className="text-[13px] text-ink-3">{formatDate(event.on)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <SourceNote
        source={providerWording(invoice.source).name}
        lastSyncAt={origin?.lastSyncAt ?? null}
        now={now}
      />
    </div>
  );
}
