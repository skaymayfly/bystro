import { replySubject } from "@bystro/core";
import {
  countMailMessages,
  countUnreadInboxThreads,
  getMailThread,
  listMailFolder,
  readEncryptionKey,
  type MailThreadDetail,
  type MailThreadListItem,
} from "@bystro/db";
import { ArrowLeft, Inbox, Mail, Paperclip, PenLine, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  PageHeader,
  ScreenEmpty,
  SEGMENTED_BAR,
  segmentClass,
  SoonBadge,
} from "@/components/bits";
import { ConnectForm } from "@/components/connections/connect-form";
import { ConnectOutcomeNotice, loadConnections } from "@/components/connections/connections-tab";
import { ArchiveButton } from "@/components/mail/archive-button";
import { AutoRefresh } from "@/components/mail/auto-refresh";
import { NewMail, ReplyBox } from "@/components/mail/composer";
import { Button, buttonVariants } from "@/components/ui/button";
import { relativeTime } from "@/lib/connection-status";
import {
  addressLabel,
  formatMailDateTime,
  formatMailTime,
  MAIL_FOLDER_LABELS,
  mailHref,
  parseMailFolder,
  type MailFolderKey,
} from "@/lib/mail-view";
import { initials } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { requireRequestContext } from "@/server/context";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Pošta – Bystro" };

const THREAD_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** "1 zpráva", "3 zprávy", "5 zpráv". */
const messagesWord = (count: number) =>
  count === 1 ? "zpráva" : count >= 2 && count <= 4 ? "zprávy" : "zpráv";
const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

function ThreadRow({
  thread,
  href,
  selected,
  now,
}: {
  thread: MailThreadListItem;
  href: string;
  selected: boolean;
  now: Date;
}) {
  const who = addressLabel(thread.counterpart);
  return (
    <li>
      <Link
        href={href}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "grid grid-cols-[8px_36px_minmax(0,1fr)] gap-x-2.5 border-t border-line-soft px-4 py-3 transition-colors hover:bg-chip",
          selected && "bg-chip",
        )}
      >
        <span
          aria-hidden
          className={cn("mt-4 size-2 rounded-full", thread.unread ? "bg-link" : "bg-transparent")}
        />
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-full bg-chip text-[11px] font-semibold text-ink-2"
        >
          {initials(who)}
        </span>
        <span className="min-w-0">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn("truncate text-sm", thread.unread ? "font-semibold" : "font-medium")}
            >
              {who}
              {thread.messageCount > 1 && (
                <span className="ml-1 font-normal text-ink-4">{thread.messageCount}</span>
              )}
            </span>
            <span className="flex-none text-xs text-ink-3 tabular-nums">
              {formatMailTime(thread.lastMessageAt, now)}
            </span>
          </span>
          <span
            className={cn("block truncate text-[13px]", thread.unread ? "text-ink" : "text-ink-2")}
          >
            {thread.subject ?? "(bez předmětu)"}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            {thread.hasAttachments && (
              <Paperclip aria-label="Má přílohu" size={12} className="flex-none" />
            )}
            <span className="truncate">{thread.snippet}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Who a reply goes to: whoever wrote last other than the user, else whom the user wrote to. */
function replyTarget(thread: MailThreadDetail): string {
  const received = [...thread.messages]
    .reverse()
    .find((message) => !message.labels.includes("SENT"));
  const people =
    received?.from !== null && received !== undefined
      ? [received.from]
      : (thread.messages.at(-1)?.to ?? []);
  return people
    .map((person) => (person.name === null ? person.address : `${person.name} <${person.address}>`))
    .join(", ");
}

function ThreadDetail({
  thread,
  backHref,
  canSend,
}: {
  thread: MailThreadDetail;
  backHref: string;
  canSend: boolean;
}) {
  return (
    <Card className="gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink lg:hidden"
          >
            <ArrowLeft aria-hidden size={14} />
            Zpět
          </Link>
          <h2 className="text-lg font-semibold tracking-[-0.01em]">
            {thread.subject ?? "(bez předmětu)"}
          </h2>
        </div>
        {thread.inInbox && <ArchiveButton threadId={thread.externalId} backHref={backHref} />}
      </div>
      <ol aria-label="Zprávy ve vláknu" className="flex flex-col gap-4">
        {thread.messages.map((message) => (
          <li key={message.externalId} className="rounded-box border border-line-soft p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium">
                {addressLabel(message.from)}
                {message.from?.name !== null && message.from !== null && (
                  <span className="ml-1.5 font-normal text-ink-3">{message.from.address}</span>
                )}
              </p>
              <p className="text-xs text-ink-3 tabular-nums">
                {formatMailDateTime(message.receivedAt)}
              </p>
            </div>
            {message.to.length > 0 && (
              <p className="mt-0.5 truncate text-xs text-ink-3">
                Komu: {message.to.map(addressLabel).join(", ")}
              </p>
            )}
            {/* Untrusted text from the mailbox: rendered as text only, never as HTML. */}
            <div className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-2">
              {message.bodyText === "" ? "(bez textu)" : message.bodyText}
            </div>
            {message.hasAttachments && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
                <Paperclip aria-hidden size={12} />
                Zpráva má přílohu; otevřeš ji v Gmailu.
              </p>
            )}
          </li>
        ))}
      </ol>
      {canSend && (
        <ReplyBox
          threadId={thread.externalId}
          defaultTo={replyTarget(thread)}
          defaultSubject={replySubject(thread.messages.at(-1)?.subject ?? thread.subject)}
        />
      )}
    </Card>
  );
}

/**
 * Pošta: Doručené and Odeslané of the connected Gmail, a list of threads and the open
 * thread side by side (one at a time on a phone). Mail is shown as plain text only.
 */
export default async function MailPage(props: PageProps<"/app/posta">) {
  const { organization, role } = await requireRequestContext();
  const canSend = role === "owner" || role === "admin";
  const query = await props.searchParams;
  const outcome = param(query.propojeni);
  const { mailbox, mailAvailable } =
    organization === null
      ? { mailbox: null, mailAvailable: false }
      : await loadConnections(organization.id);

  if (organization === null || mailbox === null || mailbox.status === "revoked") {
    return (
      <div className="flex flex-col gap-[22px]">
        <PageHeader title="Pošta" text="Doručené a odeslané e-maily na jednom místě" />
        <ConnectOutcomeNotice outcome={outcome} provider="gmail" />
        <ScreenEmpty
          icon={<Mail aria-hidden size={28} strokeWidth={1.6} />}
          title="E-mail zatím není propojený"
          text="Připoj Gmail. Poštu uvidíš tady, odpovídat budeš rovnou z Bystra a upomínky odejdou z tvé adresy."
        >
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {mailAvailable ? (
              <ConnectForm provider="gmail" returnTo="mail" label="Propojit e-mail" />
            ) : (
              <>
                <Button disabled>Propojit e-mail</Button>
                <SoonBadge />
              </>
            )}
          </div>
        </ScreenEmpty>
      </div>
    );
  }

  const now = new Date();
  const folder: MailFolderKey = parseMailFolder(param(query.slozka));
  const search = param(query.q)?.trim() ?? "";
  const requested = param(query.vlakno);
  const scope = { organizationId: organization.id, connectionId: mailbox.id };
  const db = getDb();
  const key = readEncryptionKey();
  const [threads, unread, open] = await Promise.all([
    listMailFolder(db, scope, { folder, query: search }, key),
    countUnreadInboxThreads(db, scope),
    requested !== undefined && THREAD_ID.test(requested)
      ? getMailThread(db, scope, requested, key)
      : Promise.resolve(null),
  ]);
  const listHref = mailHref({ folder, query: search });
  const writing = canSend && param(query.novy) === "1" && mailbox.status !== "reauth_required";
  const updated =
    mailbox.lastSyncAt === null
      ? null
      : `aktualizováno ${relativeTime(new Date(mailbox.lastSyncAt), now)}`;
  // The first load of a mailbox can take many minutes (Google lets through ~100 whole
  // messages a minute); mail appears batch by batch, so the screen keeps itself fresh.
  const loading =
    mailbox.lastSyncAt === null &&
    (mailbox.status === "syncing" ||
      mailbox.status === "connected" ||
      mailbox.status === "degraded");
  const firstLoad = loading && threads.length === 0 && search === "";
  const loaded = loading ? await countMailMessages(db, scope) : 0;

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        title="Pošta"
        text={["Gmail", mailbox.displayName, updated].filter(Boolean).join(" · ")}
      >
        {canSend && mailbox.status !== "reauth_required" && (
          <Link href="/app/posta?novy=1" className={buttonVariants({ size: "sm" })}>
            <PenLine aria-hidden />
            Nový e-mail
          </Link>
        )}
      </PageHeader>
      {param(query.odeslano) !== undefined && (
        <p role="status" className="text-sm text-success-strong">
          {param(query.odeslano) === "1" ? "E-mail odešel." : "E-mail se odesílá na pozadí."} V
          Odeslaných se objeví po nejbližší aktualizaci.
        </p>
      )}
      <ConnectOutcomeNotice outcome={outcome} provider="gmail" />
      {mailbox.status === "reauth_required" && (
        <Card className="items-start gap-3">
          <p className="text-[15px] font-medium">Gmail mi přestal dávat přístup</p>
          <p className="text-sm text-ink-3">
            Dokud je aplikace v testovacím režimu Googlu, přístup vyprší po týdnu. Připoj ho prosím
            znovu; do té doby ukazuju poštu z posledního načtení.
          </p>
          <ConnectForm provider="gmail" returnTo="mail" label="Znovu připojit" />
        </Card>
      )}

      {loading && <AutoRefresh />}
      {loading && !firstLoad && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-box border border-line bg-card px-4 py-3 text-[13px] text-ink-2 shadow-soft"
        >
          <span aria-hidden className="size-2 flex-none animate-pulse rounded-full bg-link" />
          Pořád načítám starší poštu · zatím {loaded} {messagesWord(loaded)}. Nejnovější e-maily už
          vidíš.
        </p>
      )}
      {firstLoad ? (
        <ScreenEmpty
          icon={<Mail aria-hidden size={28} strokeWidth={1.6} />}
          title="Načítám poštu"
          text="Stahuju doručené a odeslané e-maily za posledních 30 dní. U plné schránky to může chvíli trvat."
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
          <Card
            className={cn(
              "gap-0 overflow-hidden p-0",
              (open !== null || writing) && "hidden lg:flex",
            )}
          >
            <div className="flex flex-col gap-3 p-4">
              <nav aria-label="Složky pošty" className={SEGMENTED_BAR}>
                {(["inbox", "sent"] as const).map((key) => (
                  <Link
                    key={key}
                    href={mailHref({ folder: key, query: search })}
                    aria-current={folder === key ? "page" : undefined}
                    className={segmentClass(folder === key)}
                  >
                    {MAIL_FOLDER_LABELS[key]}
                    {key === "inbox" && unread > 0 && (
                      <span className="ml-1.5 text-xs text-ink-3 tabular-nums">{unread}</span>
                    )}
                  </Link>
                ))}
              </nav>
              <form
                action="/app/posta"
                role="search"
                className="flex h-10 items-center gap-2.5 rounded-full border border-line-strong bg-card px-4 text-ink-3 focus-within:border-ink-2"
              >
                <Search aria-hidden size={16} strokeWidth={1.7} className="flex-none" />
                {folder === "sent" && <input type="hidden" name="slozka" value="odeslane" />}
                <input
                  type="search"
                  name="q"
                  defaultValue={search}
                  aria-label="Hledat v poště"
                  placeholder="Hledat předmět, jméno nebo adresu"
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
                />
              </form>
            </div>
            {threads.length === 0 ? (
              <div className="flex flex-col items-center gap-1 border-t border-line-soft px-6 py-12 text-center">
                <Inbox aria-hidden size={22} className="text-ink-4" />
                <p className="text-sm font-medium">
                  {search === "" ? "Prázdno" : "Nic nenalezeno"}
                </p>
                <p className="text-[13px] text-ink-3">
                  {search === ""
                    ? "V téhle složce nic není."
                    : "Hledám v předmětu, jménech a adresách, ne v textu e-mailů."}
                </p>
              </div>
            ) : (
              <ul aria-label="Vlákna">
                {threads.map((thread) => (
                  <ThreadRow
                    key={thread.externalId}
                    thread={thread}
                    href={mailHref({ folder, query: search, thread: thread.externalId })}
                    selected={open?.externalId === thread.externalId}
                    now={now}
                  />
                ))}
              </ul>
            )}
          </Card>

          {writing ? (
            <Card className="gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-[-0.01em]">Nový e-mail</h2>
                <Link href={listHref} className="text-[13px] text-ink-3 hover:text-ink">
                  Zahodit
                </Link>
              </div>
              <NewMail />
            </Card>
          ) : open !== null ? (
            <ThreadDetail thread={open} backHref={listHref} canSend={canSend} />
          ) : (
            <Card className="hidden items-center gap-2 py-16 text-center lg:flex">
              <Mail aria-hidden size={22} className="text-ink-4" />
              <p className="text-sm text-ink-3">Vyber vlákno vlevo.</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
