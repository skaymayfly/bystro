import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Two-panel layout of the sign-in screens, taken from docs/prototyp.html ("Registrace").
 * Colours are inlined for now; step 1.5 turns them into design tokens.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-5 bg-[#F3F2EF] p-6 text-[#161514]">
      <div className="flex flex-col justify-between gap-8 rounded-[36px] bg-white p-10">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-[#161514] text-[17px] font-bold text-white">
            B
          </span>
          <span className="text-lg font-semibold">Bystro</span>
        </Link>
        <div className="mx-auto flex w-full max-w-[400px] flex-col gap-5">{children}</div>
        <p className="text-center text-[13px] text-[#8A877F]">
          Tvoje data šifrujeme a nikdy je neprodáváme.
        </p>
      </div>
      <div className="flex min-h-[420px] flex-col justify-end gap-4 rounded-[36px] bg-[#161514] p-10">
        <p className="text-[13px] text-[#A8A49D]">Co tě čeká zítra v 7:00</p>
        <p className="max-w-[520px] text-[clamp(26px,2.6vw,36px)] leading-[1.2] font-medium tracking-[-0.02em] text-pretty text-white">
          „3 klientům je potřeba odpovědět, 2 faktury jsou po splatnosti a dnes máš 4 schůzky.“
        </p>
      </div>
    </div>
  );
}

export const authStyles = {
  title: "m-0 text-[34px] font-semibold tracking-[-0.02em]",
  label: "flex flex-col gap-1.5 text-[13px] font-semibold text-[#55534E]",
  input:
    "rounded-2xl border border-[#E6E4DF] bg-[#FAFAF8] px-4 py-[15px] text-[15px] font-normal text-[#161514] outline-none focus:border-[#161514]",
  primaryButton:
    "cursor-pointer rounded-full bg-[#C94A2C] p-[17px] text-[15px] font-semibold text-white transition-colors hover:bg-[#161514] disabled:cursor-not-allowed disabled:opacity-60",
  secondaryButton:
    "cursor-pointer rounded-full bg-[#F3F2EF] p-[15px] text-[15px] font-semibold text-[#161514] disabled:cursor-not-allowed disabled:opacity-60",
  hint: "text-[14px] text-[#55534E]",
  link: "font-semibold text-[#161514] underline underline-offset-2",
  error: "rounded-2xl bg-[#FBEAE5] px-4 py-3 text-[14px] text-[#9A3412]",
  notice: "rounded-2xl bg-[#F3F2EF] px-4 py-3 text-[14px] text-[#161514]",
} as const;
