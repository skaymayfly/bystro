import type { InvoiceTone } from "@/lib/invoice-labels";
import { relativeTime } from "@/lib/connection-status";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<InvoiceTone, string> = {
  danger: "text-danger-strong",
  neutral: "text-ink-2",
  success: "text-success-strong",
};
const TONE_DOT: Record<InvoiceTone, string> = {
  danger: "bg-danger-strong",
  neutral: "bg-ink-2",
  success: "bg-success-strong",
};

/** The prototype's status pill: a dot and a label in the colour of the state. */
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
        "inline-flex items-center gap-[7px] rounded-full border border-line-strong bg-fill px-3 py-1.5 text-xs font-medium whitespace-nowrap",
        TONE_TEXT[tone],
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
  lastSyncAt,
  now,
  className,
}: {
  lastSyncAt: string | null;
  now: Date;
  className?: string;
}) {
  return (
    <p className={cn("text-xs text-ink-3", className)}>
      Zdroj: Fakturoid
      {lastSyncAt !== null && ` · aktualizováno ${relativeTime(new Date(lastSyncAt), now)}`}
    </p>
  );
}
