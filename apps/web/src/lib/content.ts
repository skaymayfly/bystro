/** Texts and option lists taken from docs/prototyp.html, shared by several screens. */

export const ASSISTANT_SUGGESTIONS = [
  "Kolik jsem vydělal minulý měsíc?",
  "Kdo mi dluží peníze?",
  "Zvládnu zaplatit DPH?",
  "Co mě dnes čeká?",
] as const;

export const FORECAST_HORIZONS = ["30 dní", "60 dní", "90 dní"] as const;

export const BRIEF_TIMES = ["6:30", "7:00", "8:00"] as const;
/** The morning brief is planned for 7:00 Europe/Prague unless the user changes it. */
export const DEFAULT_BRIEF_TIME = "7:00";

export const BRIEF_CHANNELS = ["E-mail", "Aplikace", "SMS"] as const;

/** Cash-warning thresholds in haléře. */
export const CASH_THRESHOLDS_MINOR = [0, 5_000_000, 10_000_000] as const;

export const CONNECTION_CATEGORIES = [
  { short: "@", name: "E-mail", description: "Gmail, Outlook, Seznam" },
  { short: "31", name: "Kalendář", description: "Google, Outlook" },
  { short: "Kč", name: "Banka", description: "Fio, ČSOB, KB, Air Bank a další" },
  { short: "FV", name: "Fakturace", description: "Fakturoid, iDoklad, Pohoda" },
  { short: "CRM", name: "CRM", description: "Pipedrive, Raynet, HubSpot" },
] as const;
