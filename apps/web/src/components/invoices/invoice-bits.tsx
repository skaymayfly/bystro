import type { InvoiceTone } from "@/lib/invoice-labels";
import { relativeTime } from "@/lib/connection-status";
import { cn } from "@/lib/utils";

const TONE_PILL: Record<InvoiceTone, string> = {
  danger: "bg-danger-soft text-danger-strong",
  warning: "bg-warning-soft text-warning-strong",
  neutral: "bg-chip text-ink-2",
  success: "bg-success-soft text-success-strong",
};
const TONE_DOT: Record<InvoiceTone, string> = {
  danger: "bg-danger-strong",
  warning: "bg-warning-strong",
  neutral: "bg-ink-2",
  success: "bg-success-strong",
};

/** Status badge as Stripe draws it: a soft background and a dot in the colour of the state. */
export function StatusPill({
  label,
  tone,
  className,
}: {
  label: string;
  tone: InvoiceTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        TONE_PILL[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      {label}
    </span>
  );
}

/**
 * Where the numbers come from and how fresh they are. Every figure on the Faktury screen
 * and the Přehled card is computed from data synced from this source.
 */
export function SourceNote({
  source,
  lastSyncAt,
  now,
  className,
}: {
  /** Name of the invoicing system(s), e.g. "Fakturoid" or "Fakturoid a iDoklad". */
  source: string;
  lastSyncAt: string | null;
  now: Date;
  className?: string;
}) {
  return (
    <p className={cn("text-xs text-ink-3", className)}>
      Zdroj: {source}
      {lastSyncAt !== null && ` · aktualizováno ${relativeTime(new Date(lastSyncAt), now)}`}
    </p>
  );
}
