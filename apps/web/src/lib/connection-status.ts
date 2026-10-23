import { providerWording, type ProviderWording } from "./invoicing-providers";

/** Texts for the state of a connection, as shown in Nastavení → Propojení. No I/O. */

export interface ConnectionSummary {
  /** Provider id, e.g. `fakturoid`; decides how the texts name the application. */
  provider?: string;
  /** `email` connections show no "waiting for the first load": a mailbox may take minutes. */
  category?: string;
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

/** iDoklad answers this way when the user's plan does not include the API. */
const blockedText = (provider: string | undefined, app: ProviderWording) =>
  provider === "idoklad"
    ? "iDoklad mi teď nedovolí číst data: tvůj tarif u nich vypršel nebo nestačí. Vyřeš to u nich a pak dej Aktualizovat."
    : provider === "gmail"
      ? "Správce tvé domény v Google Workspace nedovolil Bystru přístup k poště. Požádej ho o povolení."
      : `${app.name} má tvůj účet zablokovaný. Vyřeš to u nich a pak dej Aktualizovat.`;

function errorText(
  code: string | null,
  provider: string | undefined,
  app: ProviderWording,
): string | undefined {
  switch (code) {
    case "provider_not_configured":
      return `Načítání z ${app.of} u nás zatím není zapnuté. Dáme to do pořádku; kdyby to trvalo, napiš nám.`;
    case "credentials_missing":
      return `Chybí mi přístup k ${app.of}. Odpoj ho prosím a připoj znovu.`;
    case "account_blocked":
      return blockedText(provider, app);
    case "forbidden":
      return provider === "gmail"
        ? "Gmail mi nedovolil číst poštu. Zkus Gmail odpojit a připojit znovu; kdyby to nepomohlo, napiš nám."
        : `Tvůj účet ${app.inside} mi nedovolí číst faktury.`;
    case "api_disabled":
      return `Přístup k ${app.of} je u nás vypnutý v nastavení u poskytovatele. Je to chyba na naší straně; dáme to do pořádku.`;
    default:
      return undefined;
  }
}

export function describeConnection(
  connection: ConnectionSummary,
  now: Date,
): ConnectionDescription {
  const app = providerWording(connection.provider);
  const updated =
    connection.lastSyncAt === null
      ? null
      : `Aktualizováno ${relativeTime(new Date(connection.lastSyncAt), now)}.`;

  if (connection.needsAccount) {
    return {
      tone: "warn",
      label: "Vyber účet",
      text: `Máš u ${app.of} víc účtů. Vyber, který mám číst.`,
      busy: false,
    };
  }
  switch (connection.status) {
    case "syncing":
      return { tone: "busy", label: "Synchronizuji…", text: null, busy: true };
    case "connected": {
      if (connection.category === "email" && updated === null) {
        return { tone: "ok", label: "Připojeno", text: null, busy: false };
      }
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
            ? `${app.name} teď nepřijímá další dotazy. Zkusím to za chvíli.`
            : "Poslední aktualizace se nepovedla. Zkusím to znovu.",
        busy: false,
      };
    case "reauth_required":
      return {
        tone: "error",
        label: "Je potřeba znovu připojit",
        text: `${app.name} mi přestal dávat přístup. Připoj ho prosím znovu.`,
        busy: false,
      };
    case "error":
      return {
        tone: "error",
        label: "Něco se nepovedlo",
        text:
          errorText(connection.lastErrorCode, connection.provider, app) ??
          "Zkus to prosím později. Kdyby to trvalo, napiš nám.",
        busy: false,
      };
    case "revoked":
      return { tone: "warn", label: "Odpojeno", text: null, busy: false };
  }
}

export interface ConnectOutcomeNotice {
  tone: "ok" | "error";
  text: string;
}

/**
 * Sentence shown after coming back from the provider, by the `propojeni` and `aplikace`
 * query values. `null` for an outcome that does not exist.
 */
export function connectOutcomeNotice(
  outcome: string | undefined,
  provider: string | undefined,
): ConnectOutcomeNotice | null {
  const app = providerWording(provider);
  switch (outcome) {
    case "ok":
      return provider === "gmail"
        ? { tone: "ok", text: "Gmail je propojený." }
        : { tone: "ok", text: `${app.name} je propojený. Faktury načtu během chvilky.` };
    case "vybrat-ucet":
      return { tone: "ok", text: "Skoro hotovo. Ještě vyber, který účet mám číst." };
    case "zamitnuto":
      return { tone: "error", text: "Propojení jsi nepovolil, takže nic nečtu." };
    case "neplatne":
      return { tone: "error", text: "Tenhle odkaz už neplatí. Zkus to prosím znovu." };
    case "nedostupne":
      return { tone: "error", text: `${app.name} teď neodpovídá. Zkus to prosím za chvíli.` };
    case "bez-uctu":
      return {
        tone: "error",
        text: `U ${app.of} jsem nenašel účet, ze kterého můžu číst faktury.`,
      };
    case "tarif":
      return {
        tone: "error",
        text: `${app.name} mi nedovolí číst data: tvůj tarif u nich vypršel nebo nestačí. Vyřeš to u nich a zkus to znovu.`,
      };
    case "opravneni":
      return {
        tone: "error",
        text: `Bez povolení číst a posílat poštu ${app.withIt} pracovat nemůžu. Zkus to znovu a nech zaškrtnuté všechny volby.`,
      };
    default:
      return null;
  }
}
