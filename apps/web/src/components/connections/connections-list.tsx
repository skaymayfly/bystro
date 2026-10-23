"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  describeConnection,
  type ConnectionSummary,
  type ConnectionTone,
} from "@/lib/connection-status";
import { parseInvoicingProvider } from "@/lib/invoicing-providers";

/** Applications whose connection can be renewed with the "Znovu připojit" button. */
const reconnectable = (provider: string) =>
  provider === "gmail" ? "gmail" : parseInvoicingProvider(provider);
import { cn } from "@/lib/utils";

import { ConnectForm, type ConnectReturnTarget } from "./connect-form";

export interface ConnectionItem extends ConnectionSummary {
  id: string;
  provider: string;
  category: string;
  displayName: string | null;
}

const PROVIDER_NAMES: Record<string, { name: string; category: string }> = {
  fakturoid: { name: "Fakturoid", category: "Fakturace" },
  idoklad: { name: "iDoklad", category: "Fakturace" },
  gmail: { name: "Gmail", category: "E-mail" },
};

const TONE_CLASSES: Record<ConnectionTone, string> = {
  ok: "bg-success-soft text-success-strong",
  busy: "bg-fill text-ink-2",
  warn: "bg-warning-soft text-warning-strong",
  error: "bg-danger-soft text-danger-strong",
};
const DOT_CLASSES: Record<ConnectionTone, string> = {
  ok: "bg-success",
  busy: "bg-ink-3",
  warn: "bg-warning-strong",
  error: "bg-danger",
};

const POLL_MS = 4_000;
/** Stop asking after a while; the page can always be reloaded. */
const MAX_POLLS = 45;

const SYNC_MESSAGES: Record<number, string> = {
  202: "Aktualizuji…",
  409: "Tohle propojení teď aktualizovat nejde.",
  429: "Aktualizovat jde jednou za 5 minut.",
};

/** Connected apps with their state. Refreshes itself while a sync is under way. */
export function ConnectionsList({
  initial,
  returnTo,
}: {
  initial: readonly ConnectionItem[];
  returnTo: ConnectReturnTarget;
}) {
  const router = useRouter();
  const [connections, setConnections] = useState(initial);
  const [now, setNow] = useState(() => new Date());
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    setConnections(initial);
  }, [initial]);

  const busy = connections.some((connection) => describeConnection(connection, now).busy);
  useEffect(() => {
    if (!busy || polls >= MAX_POLLS) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/integrations/connections", { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json()) as { connections: ConnectionItem[] };
          setConnections(body.connections);
        }
      } catch {
        // Offline for a moment: the next round tries again.
      }
      setNow(new Date());
      setPolls((count) => count + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [busy, polls, connections]);

  async function post(id: string, action: "sync" | "disconnect"): Promise<Response | null> {
    setPending(id);
    try {
      return await fetch(`/api/integrations/connections/${id}/${action}`, { method: "POST" });
    } catch {
      return null;
    } finally {
      setPending(null);
    }
  }

  async function onSync(id: string) {
    const response = await post(id, "sync");
    const message = SYNC_MESSAGES[response?.status ?? 0] ?? "Teď to nejde. Zkus to později.";
    setMessages((current) => ({ ...current, [id]: message }));
    if (response?.status === 202) {
      setConnections((current) =>
        current.map((item) => (item.id === id ? { ...item, status: "syncing" as const } : item)),
      );
      setPolls(0);
    }
  }

  async function onDisconnect(id: string, name: string) {
    if (!window.confirm(`Opravdu odpojit ${name}? Faktury z něj přestanu ukazovat.`)) {
      return;
    }
    const response = await post(id, "disconnect");
    if (response?.ok) {
      setConnections((current) => current.filter((item) => item.id !== id));
      router.refresh();
    } else {
      setMessages((current) => ({ ...current, [id]: "Odpojení se nepovedlo. Zkus to znovu." }));
    }
  }

  if (connections.length === 0) {
    return (
      <p className="px-[18px] py-9 text-center text-sm text-ink-3">
        Zatím nic. Vyber aplikaci vlevo.
      </p>
    );
  }

  return (
    <ul>
      {connections.map((connection) => {
        const provider = PROVIDER_NAMES[connection.provider] ?? {
          name: connection.provider,
          category: "Aplikace",
        };
        const state = describeConnection(connection, now);
        const reconnect = reconnectable(connection.provider);
        const canSync =
          connection.category === "invoicing" &&
          !connection.needsAccount &&
          (connection.status === "connected" ||
            connection.status === "degraded" ||
            connection.status === "error");
        return (
          <li
            key={connection.id}
            className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-line-soft px-[18px] py-[13px] last:border-b-0"
          >
            <div className="min-w-[160px] flex-1">
              <p className="text-[15px] font-medium">{provider.name}</p>
              <p className="truncate text-[13px] text-ink-3">
                {provider.category}
                {connection.displayName !== null && ` · ${connection.displayName}`}
              </p>
            </div>
            <span
              role="status"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-xs whitespace-nowrap",
                TONE_CLASSES[state.tone],
              )}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASSES[state.tone])} />
              {state.label}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {canSync && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending === connection.id}
                  onClick={() => void onSync(connection.id)}
                >
                  Aktualizovat
                </Button>
              )}
              {connection.status === "reauth_required" && reconnect !== null && (
                <ConnectForm
                  provider={reconnect}
                  returnTo={returnTo}
                  label="Znovu připojit"
                  size="sm"
                />
              )}
              <Button
                variant="outline"
                size="sm"
                className="hover:border-danger hover:text-danger-strong"
                disabled={pending === connection.id}
                onClick={() => void onDisconnect(connection.id, provider.name)}
              >
                Odpojit
              </Button>
            </div>
            {(state.text !== null || messages[connection.id] !== undefined) && (
              <p className="w-full text-[13px] leading-normal text-ink-3">
                {messages[connection.id] ?? state.text}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
