import { formatDate, formatWeekday, toDateParts } from "@bystro/core";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardTitle, DashedEmpty, PillOptions, SoonBadge } from "@/components/bits";
import { Button, buttonVariants } from "@/components/ui/button";
import { ASSISTANT_SUGGESTIONS, FORECAST_HORIZONS } from "@/lib/content";
import { greeting } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Přehled – Bystro" };

const pragueHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  hour: "2-digit",
  hourCycle: "h23",
});

const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase("cs-CZ") + value.slice(1);

/** Přehled with nothing connected yet: every block is the prototype's empty state. */
export default function DashboardPage() {
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] items-center gap-8 rounded-panel bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-[18px]">
          <div className="flex items-center gap-3.5">
            <span className="flex size-[68px] items-center justify-center rounded-full border border-line text-[28px] font-semibold">
              {toDateParts(now).day}
            </span>
            <span className="text-[15px] leading-[1.3] text-ink-2">
              {capitalize(formatWeekday(now))},
              <br />
              {formatDate(now, "long")}
            </span>
          </div>
          <h1 className="text-[clamp(26px,2.6vw,36px)] leading-[1.2] font-medium tracking-[-0.02em] text-pretty">
            {greeting(Number(pragueHour.format(now)))} E-mail zatím nevidím,{" "}
            <span className="text-brand">faktury nevidím</span> a{" "}
            <span className="text-brand">banku taky ne</span>.
          </h1>
        </div>

        <div className="flex flex-col gap-3.5 rounded-card bg-secondary p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Na co se chceš zeptat?</h2>
            <SoonBadge />
          </div>
          <div className="flex items-center gap-2 rounded-full bg-card py-1.5 pr-1.5 pl-5">
            <input
              disabled
              aria-label="Otázka pro asistenta"
              placeholder="Zeptej se normálně česky…"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-ink-4 disabled:cursor-not-allowed"
            />
            <Button size="icon" disabled aria-label="Odeslat otázku">
              →
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ASSISTANT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled
                className="cursor-not-allowed rounded-full bg-card px-3.5 py-[9px] text-[13px] font-medium text-ink opacity-60"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
        <Card>
          <CardTitle>Odpovědět</CardTitle>
          <DashedEmpty
            title="E-mail zatím není propojený"
            text="Připoj schránku a každé ráno ti řeknu, kdo čeká na odpověď."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ink" size="sm" className="px-[18px] py-[11px] text-sm" disabled>
                Připojit e-mail
              </Button>
              <SoonBadge />
            </div>
          </DashedEmpty>
        </Card>

        <Card>
          <CardTitle>Po splatnosti</CardTitle>
          <DashedEmpty
            title="Faktury zatím nevidím"
            text="Propoj Fakturoid, iDoklad nebo Pohodu a pohlídám ti splatnosti."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ink" size="sm" className="px-[18px] py-[11px] text-sm" disabled>
                Připojit fakturaci
              </Button>
              <SoonBadge />
            </div>
          </DashedEmpty>
        </Card>

        <section className="flex flex-col gap-3.5 rounded-card bg-ink p-6 text-white">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Dnešní schůzky</h2>
            <SoonBadge />
          </div>
          <div className="flex flex-1 flex-col justify-center gap-3 rounded-tile border-[1.5px] border-dashed border-ink-line p-6">
            <h3 className="text-base font-semibold">Kalendář zatím není propojený</h3>
            <p className="text-sm leading-normal text-on-ink-muted">
              Až ho připojíš, uvidíš tu dnešní program.
            </p>
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-5 rounded-card bg-card p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Hlídač peněz</h2>
            <p className="text-sm text-ink-3">Zůstatek na účtech dnes</p>
            <p className="text-[40px] leading-tight font-semibold tracking-[-0.03em] text-ink-4">
              —
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PillOptions label="Období předpovědi" options={FORECAST_HORIZONS} size="sm" />
            <Link
              href="/app/hlidac-penez"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              Detail →
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 rounded-tile border-[1.5px] border-dashed border-line-dashed p-6 sm:p-8">
          <h3 className="text-lg font-semibold">
            Propoj banku a uvidíš, kolik ti zbude za 30, 60 a 90 dní
          </h3>
          <p className="text-sm text-ink-2">
            Přístup je jen pro čtení. Peníze z účtu nikdy nepohnu.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled>Připojit banku</Button>
            <SoonBadge />
          </div>
        </div>
      </section>
    </div>
  );
}
