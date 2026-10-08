/** Texts and option lists taken from docs/prototyp/prototyp-v4.dc.html, shared by several screens. */

export const ASSISTANT_SUGGESTIONS = [
  "Kolik jsem vydělal minulý měsíc?",
  "Kdo mi dluží peníze?",
  "Zvládnu zaplatit DPH?",
  "Co mě dnes čeká?",
] as const;

export const ASSISTANT_TOPICS = [
  {
    title: "Peníze",
    questions: [
      "Kolik jsem vydělal minulý měsíc?",
      "Zvládnu zaplatit DPH?",
      "Jak na tom budu v prosinci?",
    ],
  },
  {
    title: "Faktury a klienti",
    questions: ["Kdo mi dluží peníze?", "Který klient platí nejpozději?"],
  },
  { title: "Můj den", questions: ["Co mě dnes čeká?", "Komu mám odpovědět?"] },
] as const;

export const BRIEF_TIMES = ["6:30", "7:00", "8:00"] as const;
/** The morning brief is planned for 7:00 Europe/Prague unless the user changes it. */
export const DEFAULT_BRIEF_TIME = "7:00";

export const BRIEF_CHANNELS = ["E-mail", "Aplikace", "SMS"] as const;

export const BRIEF_CONTENTS = [
  { name: "E-maily k odpovědi", example: "„3 klienti čekají na odpověď“" },
  { name: "Faktury po splatnosti", example: "„2 faktury za 130 400 Kč“" },
  { name: "Schůzky", example: "„Dnes máš 4 schůzky, první v 9:30“" },
  { name: "Cash-flow varování", example: "„Za 18 dní může chybět 74 000 Kč“" },
] as const;

export const TONE_OPTIONS = [
  { name: "Tykání", example: "„Ahoj Petře, dnes máš 4 schůzky.“" },
  { name: "Vykání", example: "„Dobrý den, dnes máte 4 schůzky.“" },
  { name: "Stručně", example: "„4 schůzky, 2 faktury po splatnosti.“" },
] as const;
export const DEFAULT_TONE = "Tykání";

/** Cash-warning thresholds in haléře. */
export const CASH_THRESHOLDS_MINOR = [0, 5_000_000, 10_000_000] as const;

/** What Bystro can be connected to, by category. */
export const CONNECTION_CATEGORIES = ["E-mail", "Kalendář", "Banka", "Fakturace", "CRM"] as const;

export interface Provider {
  name: string;
  /** Letter mark shown on the tile instead of a logo. */
  mark: string;
  background: string;
  color: string;
}

/** Provider tiles of the prototype's app picker, in its order. */
export const PROVIDERS: readonly Provider[] = [
  { name: "Gmail", mark: "G", background: "#EA4335", color: "#FFFFFF" },
  { name: "Outlook", mark: "O", background: "#0F6CBD", color: "#FFFFFF" },
  { name: "Seznam", mark: "S", background: "#CC0000", color: "#FFFFFF" },
  { name: "Google Kalendář", mark: "31", background: "#1A73E8", color: "#FFFFFF" },
  { name: "Fio banka", mark: "F", background: "#1C9E4B", color: "#FFFFFF" },
  { name: "ČSOB", mark: "Č", background: "#0D3B85", color: "#FFFFFF" },
  { name: "Komerční banka", mark: "KB", background: "#E2001A", color: "#FFFFFF" },
  { name: "Air Bank", mark: "A", background: "#7AB929", color: "#0B1A00" },
  { name: "Fakturoid", mark: "F", background: "#19B394", color: "#FFFFFF" },
  { name: "iDoklad", mark: "iD", background: "#0A6CFF", color: "#FFFFFF" },
  { name: "Pohoda", mark: "P", background: "#F2C200", color: "#1A1400" },
  { name: "Pipedrive", mark: "P", background: "#111111", color: "#FFFFFF" },
  { name: "Raynet", mark: "R", background: "#F29100", color: "#1A0F00" },
  { name: "HubSpot", mark: "H", background: "#FF7A59", color: "#FFFFFF" },
];
