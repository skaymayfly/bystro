import { ArrowUp, ChevronRight } from "lucide-react";
import type { Metadata } from "next";

import { Card, LogoMark, PageHeader, SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { ASSISTANT_SUGGESTIONS, ASSISTANT_TOPICS, CONNECTION_CATEGORIES } from "@/lib/content";

export const metadata: Metadata = { title: "Asistent – Bystro" };

const eyebrowClass = "text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase";

/** Asistent before the AI layer exists (phase 6): the prototype's empty conversation. */
export default function AssistantPage() {
  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        title="Asistent"
        muted="ví o tvé firmě všechno"
        text="Ptej se normálně česky. Odpovídám z tvého e-mailu, kalendáře, faktur a banky."
      >
        <SoonBadge />
      </PageHeader>

      <div className="flex flex-wrap items-start gap-3.5">
        <div className="flex max-w-[380px] min-w-0 flex-[1_1_280px] flex-col gap-3.5">
          {ASSISTANT_TOPICS.map((topic) => (
            <Card key={topic.title} className="gap-1.5 px-5 py-[18px]">
              <h2 className={`${eyebrowClass} pb-1.5`}>{topic.title}</h2>
              {topic.questions.map((question) => (
                <button
                  key={question}
                  type="button"
                  disabled
                  className="-mx-3 flex cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-ink-2 opacity-60"
                >
                  <span className="flex-1">{question}</span>
                  <ChevronRight aria-hidden size={14} className="text-ink-4" />
                </button>
              ))}
            </Card>
          ))}
          <Card className="gap-1 px-5 py-[18px]">
            <h2 className={`${eyebrowClass} pb-2`}>Co vidím</h2>
            <ul>
              {CONNECTION_CATEGORIES.map((category) => (
                <li key={category} className="flex items-center gap-2.5 py-[7px] text-sm">
                  <span aria-hidden className="size-[7px] rounded-full bg-line-dark" />
                  <span className="flex-1">{category}</span>
                  <span className="text-xs text-ink-3">Nepropojeno</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="min-h-[calc(100vh-260px)] flex-[999_1_520px] gap-0 p-0">
          <div className="flex flex-1 flex-col items-center justify-center gap-[18px] px-6 py-14 text-center">
            <LogoMark className="size-16" />
            <p className="text-[clamp(26px,2.6vw,34px)] leading-[1.15] font-medium tracking-[-0.03em]">
              Na co se chceš zeptat?
            </p>
            <p className="max-w-[420px] text-[15px] leading-normal text-ink-3">
              Vyber otázku vlevo nebo napiš vlastní. Klidně i s překlepem.
            </p>
            <div className="mt-2 grid w-full max-w-[620px] grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2">
              {ASSISTANT_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-tile border border-line bg-muted p-4 text-left text-sm leading-[1.35] font-medium text-ink opacity-60"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-line px-5 pt-4 pb-5">
            <div className="flex items-center gap-2 rounded-full border border-line-strong bg-card py-1.5 pr-1.5 pl-[22px]">
              <input
                disabled
                aria-label="Otázka pro asistenta"
                placeholder="Napiš otázku… třeba „Kdo mi dluží peníze?“"
                className="min-w-0 flex-1 bg-transparent py-3 text-[15px] outline-none placeholder:text-ink-4 disabled:cursor-not-allowed"
              />
              <Button size="icon" disabled aria-label="Odeslat otázku">
                <ArrowUp aria-hidden />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
