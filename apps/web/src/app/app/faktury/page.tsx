import type { Metadata } from "next";

import { PageHeader, ScreenEmpty, SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Faktury – Bystro" };

/** Faktury without a connected invoicing system: the prototype's empty state. */
export default function InvoicesPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Fakturace není propojená" title="Faktury" />

      <ScreenEmpty
        icon={
          <span
            className="size-[72px] rounded-[22px] border-[1.5px] border-dashed border-line-strong bg-secondary"
            aria-hidden
          />
        }
        title="Zatím tu žádné faktury nejsou"
        text="Propoj svůj fakturační systém. Načtu faktury za poslední rok a začnu hlídat splatnosti."
      >
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button size="lg" disabled>
            Připojit fakturaci
          </Button>
          <SoonBadge />
        </div>
      </ScreenEmpty>
    </div>
  );
}
