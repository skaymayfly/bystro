import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The round "B" mark with the product name, as in the prototype. */
export function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-full bg-ink text-[17px] font-bold text-white">
        B
      </span>
      <span className="text-lg font-semibold">Bystro</span>
    </Link>
  );
}

/** Marks something that is shown for orientation but does not work yet. */
export function SoonBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-brand-soft px-[9px] py-[3px] text-xs font-semibold whitespace-nowrap text-brand-strong",
        className,
      )}
    >
      Připravujeme
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-3.5 rounded-card bg-card p-6", className)}>
      {children}
    </section>
  );
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {aside}
    </div>
  );
}

/** Page heading used by Hlídač peněz, Faktury and Nastavení. */
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-2 pt-3 pb-1">
      <div>
        {eyebrow !== undefined && <p className="text-sm text-ink-3">{eyebrow}</p>}
        <h1 className="text-[40px] leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
      </div>
      {children}
    </header>
  );
}

/** Dashed box inside a card: "nothing connected yet". */
export function DashedEmpty({
  title,
  text,
  children,
  className,
}: {
  title: string;
  text: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col justify-center gap-3 rounded-tile border-[1.5px] border-dashed border-line-dashed p-6",
        className,
      )}
    >
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm leading-normal text-ink-2">{text}</p>
      {children}
    </div>
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
    <section className="flex flex-col items-center gap-3.5 rounded-panel bg-card px-6 py-16 text-center sm:px-10">
      {icon}
      <h2 className="max-w-[520px] text-[28px] leading-tight font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      <p className="max-w-[460px] text-base leading-normal text-ink-2">{text}</p>
      {children}
    </section>
  );
}

/** A row of pill options; `selected` highlights one. Not interactive yet. */
export function PillOptions({
  options,
  selected,
  tone = "light",
  size = "default",
  label,
}: {
  options: readonly string[];
  selected?: string;
  /** `light` = white active pill on a grey track, `dark` = ink active pill on a white track. */
  tone?: "light" | "dark" | "plain";
  size?: "sm" | "default";
  label: string;
}) {
  const track =
    tone === "light"
      ? "rounded-full bg-secondary p-1"
      : tone === "dark"
        ? "rounded-full bg-card p-1"
        : "gap-2";
  const active = tone === "light" ? "bg-card text-ink" : "bg-ink text-white";
  const idle = tone === "plain" ? "bg-secondary text-ink" : "bg-transparent text-ink";
  const padding =
    size === "sm"
      ? "px-3.5 py-[9px] text-[13px]"
      : tone === "plain"
        ? "px-[18px] py-[11px] text-[15px]"
        : "px-[18px] py-[11px] text-sm";

  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap", track)}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled
          aria-pressed={option === selected}
          className={cn(
            "cursor-not-allowed rounded-full font-semibold",
            padding,
            option === selected ? active : cn(idle, "opacity-60"),
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
