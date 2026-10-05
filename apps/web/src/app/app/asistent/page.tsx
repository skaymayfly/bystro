import type { Metadata } from "next";

import { SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { ASSISTANT_SUGGESTIONS } from "@/lib/content";

export const metadata: Metadata = { title: "Asistent – Bystro" };

/** Asistent before the AI layer exists (phase 6): the prototype's empty conversation. */
export default function AssistantPage() {
  return (
    <section className="flex min-h-[calc(100vh-11rem)] flex-col rounded-panel bg-card md:min-h-[calc(100vh-60px)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-6 py-6 sm:px-8">
        <div>
          <h1 className="text-[22px] font-semibold">Asistent</h1>
          <p className="text-[13px] text-ink-3">Vidí tvůj e-mail, kalendář, faktury a banku</p>
        </div>
        <SoonBadge />
      </header>

      <div className="mx-auto flex w-full max-w-[820px] flex-1 flex-col justify-center gap-5 px-6 py-10 sm:px-8">
        <p className="text-[clamp(30px,3.4vw,44px)] leading-[1.1] font-medium tracking-[-0.025em]">
          Ptej se, jako by ses ptal účetní.
          <br />
          <span className="text-ink-4">Jen odpovím hned.</span>
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2.5">
          {ASSISTANT_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled
              className="cursor-not-allowed rounded-tile bg-secondary p-[18px] text-left text-[15px] leading-[1.35] font-medium text-ink opacity-60"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[884px] px-6 pt-4 pb-7 sm:px-8">
        <div className="flex items-center gap-2 rounded-full bg-secondary py-1.5 pr-1.5 pl-[22px]">
          <input
            disabled
            aria-label="Otázka pro asistenta"
            placeholder="Napiš otázku… třeba „Kdo mi dluží peníze?“"
            className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none placeholder:text-ink-4 disabled:cursor-not-allowed"
          />
          <Button size="icon" className="size-12" disabled aria-label="Odeslat otázku">
            →
          </Button>
        </div>
      </div>
    </section>
  );
}
