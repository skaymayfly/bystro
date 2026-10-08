import { FileText } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader, ScreenEmpty, SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Faktury – Bystro" };

/** Faktury without a connected invoicing system: the prototype's empty state. */
export default function InvoicesPage() {
  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader title="Faktury" text="Fakturace není propojená" />

      <ScreenEmpty
        icon={<FileText aria-hidden size={28} strokeWidth={1.6} />}
        title="Zatím tu žádné faktury nejsou"
        text="Propoj svůj fakturační systém. Načtu faktury za poslední rok a začnu hlídat splatnosti."
      >
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button disabled>Připojit fakturaci</Button>
          <SoonBadge />
        </div>
      </ScreenEmpty>
    </div>
  );
}
