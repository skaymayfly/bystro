"use client";

import { parseAddressList } from "@bystro/core";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REQUEST_ERRORS: Record<string, string> = {
  forbidden: "Odesílat může majitel nebo správce firmy.",
  invalid: "Zkontroluj příjemce a předmět.",
  not_found: "Tohle vlákno už ve schránce není.",
  reauth_required: "Gmail je potřeba znovu připojit. Pak to zkus znovu.",
  conflict: "Tenhle e-mail už se odesílá.",
};
const SEND_ERRORS: Record<string, string> = {
  rate_limited: "Gmail teď další e-maily nepustí (denní limit). Zkus to později.",
  reauth_required: "Gmail je potřeba znovu připojit. Pak to zkus znovu.",
  mailbox_missing: "Schránka už není propojená.",
  interrupted: "Odesílání se přerušilo a e-mail neodešel. Zkus to znovu.",
};
const FALLBACK = "Odeslat se nepovedlo. Zkus to prosím znovu.";
const POLL_MS = 1_500;
const POLL_LIMIT_MS = 60_000;

const fieldClass =
  "w-full rounded-control border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-4 focus:border-link focus:shadow-focus";

/** Every comma-separated part must be an address; nothing is dropped silently. */
function readAddresses(value: string) {
  const parts = value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const parsed = parseAddressList(value.replace(/;/g, ","));
  return parsed.length === parts.length ? parsed : null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Writing an e-mail: a reply in a thread or a new message. Plain text only. Clicking
 * Odeslat approves sending; the composer's own key makes sure a double click sends once.
 */
export function Composer({
  threadId,
  defaultTo,
  defaultSubject,
  onDone,
  className,
}: {
  threadId: string | null;
  defaultTo: string;
  defaultSubject: string;
  /** Called when the e-mail went out, or is still on its way after a minute. */
  onDone: (outcome: "sent" | "pending") => void;
  className?: string;
}) {
  const router = useRouter();
  // One key per opened composer: the server sends one e-mail per key.
  const [clientKey] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<"writing" | "sending" | "sent">("writing");
  const [error, setError] = useState<string | null>(null);
  const isReply = threadId !== null;

  /** `sent`, `pending` (still on its way after a minute) or the error to show. */
  async function waitForOutcome(actionId: string): Promise<"sent" | "pending" | { error: string }> {
    const started = Date.now();
    while (Date.now() - started < POLL_LIMIT_MS) {
      await wait(POLL_MS);
      const response = await fetch(`/api/mail/send/${actionId}`, { cache: "no-store" });
      if (!response.ok) continue;
      const { status, errorCode } = (await response.json()) as {
        status: string;
        errorCode: string | null;
      };
      if (status === "succeeded" || status === "verified") return "sent";
      if (status === "failed") return { error: SEND_ERRORS[errorCode ?? ""] ?? FALLBACK };
      if (status === "expired" || status === "rejected") return { error: FALLBACK };
    }
    // Still on its way: it finishes in the background; nothing is sent twice.
    return "pending";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "writing") return;
    const form = new FormData(event.currentTarget);
    const to = readAddresses(String(form.get("to") ?? ""));
    const cc = readAddresses(String(form.get("cc") ?? ""));
    if (to === null || to.length === 0 || cc === null) {
      setError("Zkontroluj adresy příjemců (odděl je čárkou).");
      return;
    }
    setError(null);
    setPhase("sending");
    try {
      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey,
          threadId,
          to,
          cc,
          subject: String(form.get("subject") ?? ""),
          body: String(form.get("body") ?? ""),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        actionId?: string;
        error?: string;
      } | null;
      if (response.status !== 202 || body?.actionId === undefined) {
        setError(REQUEST_ERRORS[body?.error ?? ""] ?? FALLBACK);
        setPhase("writing");
        return;
      }
      const outcome = await waitForOutcome(body.actionId);
      if (typeof outcome === "object") {
        setError(outcome.error);
        setPhase("writing");
        return;
      }
      setPhase("sent");
      router.refresh();
      onDone(outcome);
    } catch {
      setError(FALLBACK);
      setPhase("writing");
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label={isReply ? "Odpověď" : "Nový e-mail"}
      className={cn("flex flex-col gap-2.5", className)}
    >
      <label className="flex flex-col gap-1 text-xs text-ink-3">
        Komu
        <input name="to" defaultValue={defaultTo} required className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-3">
        Kopie
        <input name="cc" className={fieldClass} placeholder="Nepovinné" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-3">
        Předmět
        <input name="subject" defaultValue={defaultSubject} required className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-3">
        Text
        <textarea
          name="body"
          rows={isReply ? 6 : 10}
          autoFocus={isReply}
          className={cn(fieldClass, "resize-y leading-relaxed")}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-4">Odejde z tvé schránky jako prostý text.</p>
        <Button type="submit" size="sm" disabled={phase !== "writing"}>
          <Send aria-hidden />
          {phase === "sending" ? "Odesílám…" : phase === "sent" ? "Odesláno" : "Odeslat"}
        </Button>
      </div>
      {error !== null && (
        <p role="alert" className="text-xs text-danger-strong">
          {error}
        </p>
      )}
    </form>
  );
}

/** "Odpovědět" under a thread, opening the composer in place. */
export function ReplyBox({
  threadId,
  defaultTo,
  defaultSubject,
}: {
  threadId: string;
  defaultTo: string;
  defaultSubject: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<"sent" | "pending" | null>(null);
  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Odpovědět
        </Button>
        {done !== null && (
          <p role="status" className="text-xs text-success-strong">
            {done === "sent" ? "Odpověď odešla." : "Odpověď se odesílá na pozadí."}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-box border border-line-soft p-4">
      <Composer
        threadId={threadId}
        defaultTo={defaultTo}
        defaultSubject={defaultSubject}
        onDone={(outcome) => {
          setDone(outcome);
          setOpen(false);
        }}
      />
    </div>
  );
}

/** "Nový e-mail" composer that goes back to Odeslané when the e-mail is out. */
export function NewMail() {
  const router = useRouter();
  return (
    <Composer
      threadId={null}
      defaultTo=""
      defaultSubject=""
      onDone={(outcome) =>
        router.push(`/app/posta?slozka=odeslane&odeslano=${outcome === "sent" ? "1" : "0"}`)
      }
    />
  );
}
