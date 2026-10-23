/** Wording and addresses of the Pošta screen. No I/O. */

export type MailFolderKey = "inbox" | "sent";

/** Folder names in the address bar, in Czech as the rest of the app's addresses. */
const FOLDER_PARAMS: Record<MailFolderKey, string> = { inbox: "dorucene", sent: "odeslane" };

export const MAIL_FOLDER_LABELS: Record<MailFolderKey, string> = {
  inbox: "Doručené",
  sent: "Odeslané",
};

export function parseMailFolder(value: unknown): MailFolderKey {
  return value === FOLDER_PARAMS.sent ? "sent" : "inbox";
}

/** Address of the Pošta screen for a folder, a search and an open thread. */
export function mailHref(state: {
  folder: MailFolderKey;
  query?: string | undefined;
  thread?: string | undefined;
}): string {
  const params = new URLSearchParams();
  if (state.folder !== "inbox") params.set("slozka", FOLDER_PARAMS[state.folder]);
  const query = state.query?.trim();
  if (query !== undefined && query !== "") params.set("q", query);
  if (state.thread !== undefined) params.set("vlakno", state.thread);
  const search = params.toString();
  return search === "" ? "/app/posta" : `/app/posta?${search}`;
}

const ZONE = "Europe/Prague";
const dayKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, dateStyle: "short" }).format(date);
const time = (date: Date) =>
  new Intl.DateTimeFormat("cs-CZ", { timeZone: ZONE, hour: "numeric", minute: "2-digit" }).format(
    date,
  );

/**
 * When a message arrived, as a list shows it: today only the time, earlier this year the
 * day and month, before that also the year. Czech time.
 */
export function formatMailTime(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) {
    return time(date);
  }
  const sameYear = dayKey(date).slice(0, 4) === dayKey(now).slice(0, 4);
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: ZONE,
    day: "numeric",
    month: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** Full date and time of a message in its detail. */
export function formatMailDateTime(date: Date): string {
  const day = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: ZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);
  return `${day} ${time(date)}`;
}

/** A person as the list names them: the display name, or the address without one. */
export function addressLabel(address: { name: string | null; address: string } | null): string {
  if (address === null) return "Neznámý odesílatel";
  return address.name ?? address.address;
}
