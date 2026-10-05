import { formatCzk } from "@bystro/core";
import type { Metadata } from "next";

import { PageHeader, PillOptions, SoonBadge } from "@/components/bits";
import {
  BRIEF_CHANNELS,
  BRIEF_TIMES,
  CASH_THRESHOLDS_MINOR,
  CONNECTION_CATEGORIES,
  DEFAULT_BRIEF_TIME,
} from "@/lib/content";

export const metadata: Metadata = { title: "Nastavení – Bystro" };

const sectionClass = "flex flex-col rounded-card bg-card p-6 sm:p-7";

/** Nastavení: the prototype's sections, none of them functional yet. */
export default function SettingsPage() {
  return (
    <div className="flex max-w-[900px] flex-col gap-4">
      <PageHeader title="Nastavení" />

      <section className={`${sectionClass} gap-3`}>
        <div>
          <h2 className="text-lg font-semibold">Propojení</h2>
          <p className="text-sm text-ink-3">Přístup jen pro čtení. Odpojit můžeš kdykoliv.</p>
        </div>
        <ul className="flex flex-col gap-3">
          {CONNECTION_CATEGORIES.map((category) => (
            <li
              key={category.name}
              className="flex items-center gap-4 rounded-tile bg-muted px-4 py-3.5"
            >
              <span className="flex size-11 flex-none items-center justify-center rounded-[14px] bg-card text-[15px] font-bold">
                {category.short}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{category.name}</span>
                <span className="block text-[13px] text-ink-3">{category.description}</span>
              </span>
              <SoonBadge />
            </li>
          ))}
        </ul>
      </section>

      <section className={`${sectionClass} gap-[22px]`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Ranní přehled</h2>
          <SoonBadge />
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="text-sm text-ink-2">Čas</p>
          <PillOptions
            label="Čas ranního přehledu"
            options={BRIEF_TIMES}
            selected={DEFAULT_BRIEF_TIME}
            tone="plain"
          />
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="text-sm text-ink-2">Kanál</p>
          <PillOptions label="Kanál ranního přehledu" options={BRIEF_CHANNELS} tone="plain" />
        </div>
      </section>

      <section className={`${sectionClass} gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Hlídač peněz</h2>
          <SoonBadge />
        </div>
        <p className="text-sm text-ink-2">Upozorni mě, když předpověď zůstatku klesne pod</p>
        <PillOptions
          label="Hranice upozornění"
          options={CASH_THRESHOLDS_MINOR.map((amount) => formatCzk(amount))}
          tone="plain"
        />
      </section>
    </div>
  );
}
