import { TrendingUp } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader, ScreenEmpty, SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Hlídač peněz – Bystro" };

/** Hlídač peněz without a connected bank: the prototype's empty state. */
export default function CashflowPage() {
  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        title="Hlídač"
        muted="peněz"
        text="Předpověď zůstatku z tvých faktur, plateb a pravidelných výdajů."
      />

      <ScreenEmpty
        icon={<TrendingUp aria-hidden size={28} strokeWidth={1.6} />}
        title="Bez banky nevím, kolik ti zbude"
        text="Propoj účet jen pro čtení. Spojím pohyby s fakturami a spočítám předpověď na 30, 60 a 90 dní."
      >
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button disabled>Připojit banku</Button>
          <SoonBadge />
        </div>
      </ScreenEmpty>
    </div>
  );
}
