import type { Metadata } from "next";

import { PageHeader, PillOptions, ScreenEmpty, SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { FORECAST_HORIZONS } from "@/lib/content";

export const metadata: Metadata = { title: "Hlídač peněz – Bystro" };

/** Hlídač peněz without a connected bank: the prototype's empty state. */
export default function CashflowPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Hlídač peněz" title="Cash-flow">
        <PillOptions label="Období předpovědi" options={FORECAST_HORIZONS} tone="dark" />
      </PageHeader>

      <ScreenEmpty
        icon={<span className="size-[72px] rounded-full bg-brand-soft" aria-hidden />}
        title="Bez banky nevím, kolik ti zbude"
        text="Propoj účet jen pro čtení. Spojím pohyby s fakturami a spočítám předpověď na 30, 60 a 90 dní."
      >
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button size="lg" disabled>
            Připojit banku
          </Button>
          <SoonBadge />
        </div>
      </ScreenEmpty>
    </div>
  );
}
