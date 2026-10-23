/** Invoicing systems that can be connected, and how to talk about them in Czech. No I/O. */

export const INVOICING_PROVIDERS = ["fakturoid", "idoklad"] as const;
export type InvoicingProviderId = (typeof INVOICING_PROVIDERS)[number];

export interface ProviderWording {
  /** "Fakturoid" */
  name: string;
  /** "Fakturoidu": after "z", "u", "do", "k". */
  of: string;
  /** "ve Fakturoidu" */
  inside: string;
  /** "s Fakturoidem" */
  withIt: string;
}

const WORDING: Record<InvoicingProviderId | "gmail", ProviderWording> = {
  gmail: { name: "Gmail", of: "Gmailu", inside: "v Gmailu", withIt: "s Gmailem" },
  fakturoid: {
    name: "Fakturoid",
    of: "Fakturoidu",
    inside: "ve Fakturoidu",
    withIt: "s Fakturoidem",
  },
  idoklad: { name: "iDoklad", of: "iDokladu", inside: "v iDokladu", withIt: "s iDokladem" },
};

const GENERIC: ProviderWording = {
  name: "Fakturační systém",
  of: "fakturačního systému",
  inside: "ve fakturačním systému",
  withIt: "s fakturačním systémem",
};

export function parseInvoicingProvider(value: unknown): InvoicingProviderId | null {
  return INVOICING_PROVIDERS.find((provider) => provider === value) ?? null;
}

/** Wording for a provider id; an unknown one is spoken of as "fakturační systém". */
export function providerWording(provider: string | null | undefined): ProviderWording {
  if (provider === "gmail") return WORDING.gmail;
  const known = parseInvoicingProvider(provider);
  return known === null ? GENERIC : WORDING[known];
}

const joinAnd = (parts: readonly string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} a ${parts[parts.length - 1]}`;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export interface InvoicingSources {
  /** "Fakturoid", "Fakturoid a iDoklad" */
  names: string;
  /** "Fakturoid je propojený", "Fakturoid a iDoklad jsou propojené" */
  connected: string;
  /** "Ve Fakturoidu", "Ve Fakturoidu a v iDokladu" */
  inside: string;
  /** The oldest of the last updates: the figures are at least this fresh. */
  lastSyncAt: string | null;
  /** Some source has not been read yet. */
  loading: boolean;
}

/**
 * Describes where the invoices on a screen come from. Sources are named in a fixed order,
 * whatever order the connections come in. `null` when nothing is connected.
 */
export function describeInvoicingSources(
  connections: readonly { provider: string; lastSyncAt: string | null }[],
): InvoicingSources | null {
  const sources = INVOICING_PROVIDERS.flatMap((provider) =>
    connections.filter((connection) => connection.provider === provider),
  );
  if (sources.length === 0) {
    return null;
  }
  const wording = sources.map((source) => providerWording(source.provider));
  const names = joinAnd(wording.map((item) => item.name));
  const synced = sources
    .map((source) => source.lastSyncAt)
    .filter((value) => value !== null)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return {
    names,
    connected: sources.length === 1 ? `${names} je propojený` : `${names} jsou propojené`,
    inside: capitalize(joinAnd(wording.map((item) => item.inside))),
    lastSyncAt: synced[0] ?? null,
    loading: synced.length < sources.length,
  };
}
