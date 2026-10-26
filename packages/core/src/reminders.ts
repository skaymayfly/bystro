/**
 * Reminders of overdue invoices: when Bystro proposes one and what it says. Pure functions;
 * the wording follows the prototype, in a neutral form that fits any sender.
 */

export const REMINDER_TONES = ["formal", "soft"] as const;
export type ReminderTone = (typeof REMINDER_TONES)[number];

export interface ReminderSettings {
  /** Propose a reminder once an invoice is this many days overdue. */
  afterDays: number;
  /** After a reminder went out, propose another one no sooner than this. */
  repeatDays: number;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { afterDays: 3, repeatDays: 7 };
/** The choices offered in Nastavení → Upozornění. */
export const REMINDER_AFTER_DAYS_OPTIONS = [1, 3, 7, 14] as const;
export const REMINDER_REPEAT_DAYS_OPTIONS = [3, 7, 14] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReminderCandidate {
  daysOverdue: number;
  /** Where the reminder would go; without an address there is nothing to propose. */
  clientEmail: string | null;
  /** When the last reminder for this invoice went out or was proposed, if ever. */
  lastReminderAt: Date | null;
}

/**
 * Whether to propose a reminder now: overdue long enough, an address to write to, and no
 * reminder within the repeat period.
 */
export function shouldProposeReminder(
  candidate: ReminderCandidate,
  settings: ReminderSettings,
  now: Date,
): boolean {
  if (candidate.daysOverdue < settings.afterDays) return false;
  if (candidate.clientEmail === null || candidate.clientEmail.trim() === "") return false;
  return (
    candidate.lastReminderAt === null ||
    now.getTime() - candidate.lastReminderAt.getTime() >= settings.repeatDays * DAY_MS
  );
}

export interface ReminderTextInput {
  tone: ReminderTone;
  invoiceNumber: string;
  /** Already formatted, e.g. "112 000 Kč". */
  amount: string;
  /** Already formatted, e.g. "12. 10. 2026". */
  dueOn: string;
  /** Who signs it: the user sending it. */
  senderName: string;
}

export function reminderSubject(invoiceNumber: string): string {
  return `Připomínka faktury ${invoiceNumber}`;
}

/** The reminder's text in the chosen tone; the user may change it before sending. */
export function reminderText(input: ReminderTextInput): string {
  const signature = input.senderName.trim();
  if (input.tone === "soft") {
    return [
      "Dobrý den,",
      "",
      `jen drobnost: nevím, jestli k vám dorazila faktura ${input.invoiceNumber} na ${input.amount}. Kdyby bylo potřeba ji poslat znovu, dejte vědět.`,
      "",
      "Hezký den,",
      signature,
    ].join("\n");
  }
  return [
    "Dobrý den,",
    "",
    `připomínám fakturu ${input.invoiceNumber} na ${input.amount}, která byla splatná ${input.dueOn}. Kdyby se platba někde zasekla, dejte mi prosím vědět a najdeme řešení.`,
    "",
    "Děkuji a přeji hezký den,",
    signature,
  ].join("\n");
}
