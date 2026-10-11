/** Texts for the state of a connection, as shown in Nastavení → Propojení. No I/O. */

export interface ConnectionSummary {
  status: "connected" | "syncing" | "degraded" | "reauth_required" | "revoked" | "error";
  needsAccount: boolean;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  /** When the connection was last (re)connected or changed. */
  updatedAt: string | null;
}

export type ConnectionTone = "ok" | "busy" | "warn" | "error";

export interface ConnectionDescription {
  tone: ConnectionTone;
  /** Short badge text. */
  label: string;
  /** One sentence of detail, or `null`. */
  text: string | null;
  /** Whether the state is expected to change soon by itself (worth polling). */
  busy: boolean;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "před chvílí", "před 5 min", "před 2 h", "před 3 dny". */
export function relativeTime(then: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - then.getTime());
  if (elapsed < MINUTE) {
    return "před chvílí";
  }
  if (elapsed < HOUR) {
    return `před ${Math.floor(elapsed / MINUTE)} min`;
  }
  if (elapsed < DAY) {
    return `před ${Math.floor(elapsed / HOUR)} h`;
  }
  const days = Math.floor(elapsed / DAY);
  return days === 1 ? "včera" : `před ${days} dny`;
}

/** The first load normally takes seconds; after this long something is wrong. */
const FIRST_LOAD_PATIENCE_MS = 3 * MINUTE;

const ERROR_TEXTS: Record<string, string> = {
  provider_not_configured:
    "Načítání z Fakturoidu u nás zatím není zapnuté. Dáme to do pořádku; kdyby to trvalo, napiš nám.",
  credentials_missing: "Chybí mi přístup k Fakturoidu. Odpoj ho prosím a připoj znovu.",
  account_blocked: "Fakturoid má tvůj účet zablokovaný. Vyřeš to u nich a pak dej Aktualizovat.",
  forbidden: "Tvůj účet ve Fakturoidu mi nedovolí číst faktury.",
};

export function describeConnection(
  connection: ConnectionSummary,
  now: Date,
): ConnectionDescription {
  const updated =
    connection.lastSyncAt === null
      ? null
      : `Aktualizováno ${relativeTime(new Date(connection.lastSyncAt), now)}.`;

  if (connection.needsAccount) {
    return {
      tone: "warn",
      label: "Vyber účet",
      text: "Máš u Fakturoidu víc účtů. Vyber, který mám číst.",
      busy: false,
    };
  }
  switch (connection.status) {
    case "syncing":
      return { tone: "busy", label: "Synchronizuji…", text: null, busy: true };
    case "connected": {
      if (updated !== null) {
        return { tone: "ok", label: "Připojeno", text: updated, busy: false };
      }
      const waitingMs =
        connection.updatedAt === null
          ? 0
          : now.getTime() - new Date(connection.updatedAt).getTime();
      return waitingMs < FIRST_LOAD_PATIENCE_MS
        ? { tone: "busy", label: "Čekám na první načtení", text: null, busy: true }
        : {
            tone: "warn",
            label: "Načtení se zdrželo",
            text: "Faktury se zatím nenačetly. Zkus Aktualizovat; kdyby to nepomohlo, napiš nám.",
            busy: false,
          };
    }
    case "degraded":
      return {
        tone: "warn",
        label: "Připojeno",
        text:
          connection.lastErrorCode === "rate_limited"
            ? "Fakturoid teď nepřijímá další dotazy. Zkusím to za chvíli."
            : "Poslední aktualizace se nepovedla. Zkusím to znovu.",
        busy: false,
      };
    case "reauth_required":
      return {
        tone: "error",
        label: "Je potřeba znovu připojit",
        text: "Fakturoid mi přestal dávat přístup. Připoj ho prosím znovu.",
        busy: false,
      };
    case "error":
      return {
        tone: "error",
        label: "Něco se nepovedlo",
        text:
          ERROR_TEXTS[connection.lastErrorCode ?? ""] ??
          "Zkus to prosím později. Kdyby to trvalo, napiš nám.",
        busy: false,
      };
    case "revoked":
      return { tone: "warn", label: "Odpojeno", text: null, busy: false };
  }
}

/** Sentence shown after coming back from the provider; keyed by the `propojeni` query value. */
export const CONNECT_OUTCOME_TEXTS: Record<string, { tone: "ok" | "error"; text: string }> = {
  ok: { tone: "ok", text: "Fakturoid je propojený. Faktury načtu během chvilky." },
  "vybrat-ucet": { tone: "ok", text: "Skoro hotovo. Ještě vyber, který účet mám číst." },
  zamitnuto: { tone: "error", text: "Propojení jsi nepovolil, takže nic nečtu." },
  neplatne: { tone: "error", text: "Tenhle odkaz už neplatí. Zkus to prosím znovu." },
  nedostupne: { tone: "error", text: "Fakturoid teď neodpovídá. Zkus to prosím za chvíli." },
  "bez-uctu": {
    tone: "error",
    text: "U Fakturoidu jsem nenašel účet, ze kterého můžu číst faktury.",
  },
};
