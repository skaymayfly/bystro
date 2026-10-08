import { formatDate, formatWeekday } from "@bystro/core";
import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Panel, PanelEmpty, SoonBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { requireRequestContext } from "@/server/context";

export const metadata: Metadata = { title: "Přehled – Bystro" };

const detailLinkClass = "text-[13px] text-ink-3 hover:text-ink";

/**
 * Přehled with nothing connected yet. The prototype only draws it full of data, so the
 * panels keep its layout and each says what is missing.
 */
export default async function DashboardPage() {
  const { organization } = await requireRequestContext();
  const now = new Date();

  return (
    <div className="flex max-w-[1240px] flex-col">
      <p className="flex items-center gap-2 pt-3 text-[13px] text-ink-3">
        <Building2 aria-hidden size={14} strokeWidth={1.7} />
        {organization?.name} · {formatWeekday(now)} {formatDate(now, "long")}
      </p>
      <h1 className="mt-2.5 text-[30px] font-semibold tracking-[-0.025em]">Přehled</h1>
      <p className="mt-2 text-base leading-normal text-ink-3">
        E-mail zatím nevidím, faktury nevidím a banku taky ne.
      </p>

      <div className="mt-7 flex flex-wrap items-stretch gap-4">
        <Panel
          title="Hlídač peněz"
          className="flex-[2_1_560px]"
          aside={
            <Link href="/app/hlidac-penez" className={detailLinkClass}>
              Zobrazit vše
            </Link>
          }
        >
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold tracking-[-0.02em] text-ink-4">—</p>
            <p className="text-[13px] text-ink-3">Zůstatek na účtech dnes</p>
          </div>
          <PanelEmpty
            title="Propoj banku a uvidíš, kolik ti zbude za 30, 60 a 90 dní"
            text="Přístup je jen pro čtení. Peníze z účtu nikdy nepohnu."
          >
            <Button size="sm" disabled>
              Připojit banku
            </Button>
            <SoonBadge />
          </PanelEmpty>
        </Panel>

        <Panel title="Dnešní schůzky" className="flex-[1_1_340px]" aside={<SoonBadge />}>
          <PanelEmpty
            title="Kalendář zatím není propojený"
            text="Až ho připojíš, uvidíš tu dnešní program."
          />
        </Panel>
      </div>

      <div className="mt-4 flex flex-wrap items-stretch gap-4">
        <Panel
          title="Po splatnosti"
          className="flex-[1_1_340px]"
          aside={
            <Link href="/app/faktury" className={detailLinkClass}>
              Zobrazit vše
            </Link>
          }
        >
          <PanelEmpty
            title="Faktury zatím nevidím"
            text="Propoj Fakturoid, iDoklad nebo Pohodu a pohlídám ti splatnosti."
          >
            <Button size="sm" disabled>
              Připojit fakturaci
            </Button>
            <SoonBadge />
          </PanelEmpty>
        </Panel>

        <Panel title="Odpovědět" className="flex-[1_1_340px]">
          <PanelEmpty
            title="E-mail zatím není propojený"
            text="Připoj schránku a každé ráno ti řeknu, kdo čeká na odpověď."
          >
            <Button size="sm" disabled>
              Připojit e-mail
            </Button>
            <SoonBadge />
          </PanelEmpty>
        </Panel>
      </div>
    </div>
  );
}
