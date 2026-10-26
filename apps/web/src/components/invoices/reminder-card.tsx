"use client";

import { BellRing } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Card } from "@/components/bits";
import { AutoRefresh } from "@/components/mail/auto-refresh";
import { Button, buttonVariants } from "@/components/ui/button";

const ERRORS: Record<string, string> = {
  forbidden: "Připomínku může poslat majitel nebo správce firmy.",
  invalid: "Zkontroluj příjemce, předmět a text.",
  not_overdue: "Faktura už není po splatnosti, připomínka není potřeba.",
  no_mailbox: "Nejdřív propoj Gmail, připomínka odejde z tvé schránky.",
  conflict: "Tahle připomínka už se vyřizuje.",
};
const FALLBACK = "Poslat se nepovedlo. Zkus to prosím znovu.";

const formatPerson = (person: { name: string | null; address: string }) =>
  person.name === null ? person.address : `${person.name} <${person.address}>`;

const fieldClass =
  "w-full rounded-control border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-4 focus:border-link focus:shadow-focus";

export interface ReminderCardProps {
  invoiceId: string;
  /** Bystro proposed this reminder (the morning check), as opposed to none yet. */
  proposed: boolean;
  /** A reminder is on its way (approved or being sent). */
  sending: boolean;
  hasMailbox: boolean;
  canSend: boolean;
  defaultTo: string;
  /** Addresses to pick from: the client's, then people from Pošta who match the client. */
  suggestions: { name: string | null; address: string }[];
  subject: string;
  /** The text in the formal and the softer tone, made on the server. */
  texts: { formal: string; soft: string };
}

/**
 * The reminder of an overdue invoice, as in the prototype: who it goes to, the text in one
 * of two tones (editable), the PDF attached, and "Odeslat připomínku" as the approval.
 */
export function ReminderCard(props: ReminderCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(props.proposed);
  const [soft, setSoft] = useState(false);
  const [text, setText] = useState(props.texts.formal);
  const [to, setTo] = useState(props.defaultTo);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: object) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoices/${props.invoiceId}/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 202) {
        router.refresh();
        setOpen(false);
      } else {
        const answer = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(ERRORS[answer?.error ?? ""] ?? FALLBACK);
      }
    } catch {
      setError(FALLBACK);
    }
    setPending(false);
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void post({
      decision: "send",
      to,
      subject: String(form.get("subject") ?? ""),
      body: text,
      attachPdf: form.get("attachPdf") === "on",
    });
  }

  function switchTone() {
    // As in the prototype: the other tone starts from its own text again.
    const next = !soft;
    setSoft(next);
    setText(next ? props.texts.soft : props.texts.formal);
  }

  const title = (
    <h2 className="flex items-center gap-2.5 text-lg font-medium tracking-[-0.01em]">
      <BellRing aria-hidden size={18} strokeWidth={1.7} />
      Připomínka
    </h2>
  );

  if (props.sending) {
    return (
      <Card className="gap-2">
        <AutoRefresh intervalMs={4_000} />
        {title}
        <p role="status" className="text-sm text-ink-3">
          Připomínka se odesílá z tvé schránky.
        </p>
      </Card>
    );
  }
  if (!props.hasMailbox) {
    return (
      <Card className="items-start gap-2.5">
        {title}
        <p className="text-sm text-ink-3">
          Připomínky odcházejí z tvé vlastní schránky. Propoj Gmail a můžeš ji poslat.
        </p>
        <Link href="/app/posta" className={buttonVariants({ size: "sm" })}>
          Propojit e-mail
        </Link>
      </Card>
    );
  }
  if (!props.canSend) {
    return (
      <Card className="gap-2">
        {title}
        <p className="text-sm text-ink-3">Připomínku může poslat majitel nebo správce firmy.</p>
      </Card>
    );
  }
  if (!open) {
    return (
      <Card className="items-start gap-2.5">
        {title}
        <p className="text-sm text-ink-3">
          Napíšu klientovi slušnou připomínku, ty ji jen odešleš.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          Poslat připomínku
        </Button>
      </Card>
    );
  }

  return (
    <Card className="gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title}
        {props.proposed && (
          <span className="rounded-full bg-tint px-2.5 py-1 text-xs font-medium text-tint-ink">
            Navrhuje Bystro
          </span>
        )}
      </div>
      <form onSubmit={send} aria-label="Připomínka faktury" className="flex flex-col gap-2.5">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Komu
          <input
            name="to"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            list="reminder-recipients"
            required
            placeholder="jmeno@firma.cz"
            className={fieldClass}
          />
        </label>
        <datalist id="reminder-recipients">
          {props.suggestions.map((person) => (
            <option key={person.address} value={formatPerson(person)} />
          ))}
        </datalist>
        {props.defaultTo === "" && (
          <p className="text-xs text-ink-3">
            Klient nemá ve fakturaci e-mail. Vyber adresu, nebo ji napiš.
          </p>
        )}
        {props.suggestions.length > 0 && (
          <div role="group" aria-label="Vybrat adresu" className="flex flex-wrap gap-1.5">
            {props.suggestions.slice(0, 6).map((person) => (
              <button
                key={person.address}
                type="button"
                onClick={() => setTo(formatPerson(person))}
                aria-pressed={to === formatPerson(person)}
                className="max-w-full truncate rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-chip aria-pressed:border-link aria-pressed:text-link"
                title={person.address}
              >
                {person.name === null ? person.address : `${person.name} · ${person.address}`}
              </button>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Předmět
          <input name="subject" defaultValue={props.subject} required className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Text
          <textarea
            name="body"
            rows={9}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={`${fieldClass} resize-y leading-relaxed`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            name="attachPdf"
            defaultChecked
            className="size-4 accent-[var(--bz-cta)]"
          />
          Přiložit fakturu v PDF
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={switchTone}>
            {soft ? "Formálnější tón" : "Jemnější tón"}
          </Button>
          <div className="flex items-center gap-2">
            {props.proposed && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => void post({ decision: "dismiss" })}
              >
                Teď ne
              </Button>
            )}
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Odesílám…" : "Odeslat připomínku"}
            </Button>
          </div>
        </div>
        {error !== null && (
          <p role="alert" className="text-xs text-danger-strong">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}
