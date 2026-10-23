import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The Bystro mark: a white slash on a black rounded square. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8 flex-none", className)}>
      <rect width="64" height="64" rx="16" className="fill-ink" />
      <line
        x1="25"
        y1="47"
        x2="39"
        y2="17"
        className="stroke-on-ink"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The "by/stro" wordmark; screen readers get the plain name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[22px] leading-none font-semibold tracking-[-0.04em]", className)}>
      <span aria-hidden>
        by<span className="font-normal text-ink-4">/</span>stro
      </span>
      <span className="sr-only">Bystro</span>
    </span>
  );
}

/** Mark and wordmark together, linking home. */
export function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 self-start">
      <LogoMark className="size-7" />
      <Wordmark />
    </Link>
  );
}

/** Marks something that is shown for orientation but does not work yet. */
export function SoonBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-fill px-[7px] py-0.5 text-xs font-medium whitespace-nowrap text-ink-3",
        className,
      )}
    >
      Připravujeme
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-[18px] rounded-card border border-line bg-card px-6 py-[22px]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardTitle({
  children,
  text,
  aside,
}: {
  children: ReactNode;
  text?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-medium tracking-[-0.01em]">{children}</h2>
        {text !== undefined && <p className="mt-1 text-sm text-ink-3">{text}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Page heading of the app screens; `muted` continues the title in grey. */
export function PageHeader({
  title,
  muted,
  text,
  children,
}: {
  title: string;
  muted?: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pt-[18px]">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-[clamp(34px,3.4vw,46px)] leading-[1.05] font-medium tracking-[-0.035em]">
          {title}
          {muted !== undefined && <span className="text-ink-3"> {muted}</span>}
        </h1>
        {text !== undefined && <p className="text-[15px] text-ink-3">{text}</p>}
      </div>
      {children}
    </header>
  );
}

/** Full-width empty state of a whole screen. */
export function ScreenEmpty({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <Card className="items-center gap-3.5 px-6 py-16 text-center sm:px-8">
      <span className="flex size-16 items-center justify-center rounded-[20px] bg-fill text-ink">
        {icon}
      </span>
      <h2 className="max-w-[520px] text-[26px] leading-tight font-medium tracking-[-0.02em]">
        {title}
      </h2>
      <p className="max-w-[460px] text-[15px] leading-[1.55] text-ink-3">{text}</p>
      {children}
    </Card>
  );
}

/** Compact bordered card of the Přehled screen. */
export function Panel({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3.5 rounded-box border border-line px-5 py-[18px]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** "Nothing here yet" body of a Přehled panel. */
export function PanelEmpty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-2 py-6 text-center">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="max-w-[360px] text-sm leading-normal text-ink-3">{text}</p>
      {children !== undefined && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{children}</div>
      )}
    </div>
  );
}

/** A segmented control as on libraries.dev: a grey bar, the chosen segment a raised pill. */
export const SEGMENTED_BAR = "flex w-fit max-w-full flex-wrap rounded-full bg-chip p-1";

export function segmentClass(selected: boolean): string {
  return cn(
    "rounded-full px-[18px] py-2 text-sm font-medium whitespace-nowrap transition-[background-color,color] duration-200 ease-smooth",
    selected ? "bg-pill text-ink shadow-soft" : "text-ink-3 hover:text-ink",
  );
}

/**
 * A row of options; `selected` highlights one. Not interactive yet.
 * `segmented` = pills on a bordered track, `boxes` = an even grid of bordered boxes.
 */
export function PillOptions({
  options,
  selected,
  variant = "segmented",
  size = "default",
  label,
}: {
  options: readonly string[];
  selected?: string;
  variant?: "segmented" | "boxes";
  size?: "default" | "lg";
  label: string;
}) {
  if (variant === "boxes") {
    return (
      <div role="group" aria-label={label} className="grid grid-cols-3 gap-2.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled
            aria-pressed={option === selected}
            className={cn(
              "cursor-not-allowed rounded-control border text-ink",
              size === "lg" ? "h-16 text-[22px] font-semibold" : "h-[52px] text-[15px] font-medium",
              option === selected ? "border-ink-2 bg-muted" : "border-line-strong bg-card",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div role="group" aria-label={label} className={cn(SEGMENTED_BAR, "self-start")}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled
          aria-pressed={option === selected}
          className={cn(segmentClass(option === selected), "cursor-not-allowed")}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
