import type { ReactNode } from "react";

import { Logo } from "./bits";

/** Two-panel layout of the sign-in screens, taken from docs/prototyp.html ("Registrace"). */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-5 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-8 rounded-panel bg-card p-6 sm:p-10">
        <Logo href="/" />
        <div className="mx-auto flex w-full max-w-[400px] flex-col gap-5">{children}</div>
        <p className="text-center text-[13px] text-ink-4">
          Tvoje data šifrujeme a nikdy je neprodáváme.
        </p>
      </div>
      <div className="flex min-h-[420px] flex-col justify-end gap-4 rounded-panel bg-ink p-6 sm:p-10">
        <p className="text-[13px] text-on-ink-muted">Co tě čeká zítra v 7:00</p>
        <p className="max-w-[520px] text-[clamp(26px,2.6vw,36px)] leading-[1.2] font-medium tracking-[-0.02em] text-pretty text-white">
          „3 klientům je potřeba odpovědět, 2 faktury jsou po splatnosti a dnes máš 4 schůzky.“
        </p>
      </div>
    </div>
  );
}

export const authStyles = {
  title: "text-[34px] leading-tight font-semibold tracking-[-0.02em]",
  hint: "text-sm text-ink-2",
  link: "font-semibold text-ink underline underline-offset-2",
  error: "rounded-field bg-brand-soft px-4 py-3 text-sm text-brand-strong",
  notice: "rounded-field bg-secondary px-4 py-3 text-sm text-ink",
} as const;
