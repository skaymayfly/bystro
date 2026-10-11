import { FileText } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader, ScreenEmpty } from "@/components/bits";
import { loadConnections } from "@/components/connections/connections-tab";
import { InvoicingCta } from "@/components/connections/invoicing-cta";
import { requireRequestContext } from "@/server/context";

export const metadata: Metadata = { title: "Faktury – Bystro" };

/**
 * Faktury: the prototype's empty state until an invoicing system is connected. The list
 * itself arrives with step 2.7.
 */
export default async function InvoicesPage() {
  const { organization } = await requireRequestContext();
  const { fakturoid, fakturoidAvailable } =
    organization === null
      ? { fakturoid: null, fakturoidAvailable: false }
      : await loadConnections(organization.id);

  if (fakturoid !== null) {
    return (
      <div className="flex flex-col gap-[22px]">
        <PageHeader title="Faktury" text="Fakturoid je propojený" />
        <ScreenEmpty
          icon={<FileText aria-hidden size={28} strokeWidth={1.6} />}
          title="Fakturace je propojená"
          text="Faktury z Fakturoidu načítám na pozadí. Jejich seznam sem brzy přidáme."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader title="Faktury" text="Fakturace není propojená" />

      <ScreenEmpty
        icon={<FileText aria-hidden size={28} strokeWidth={1.6} />}
        title="Zatím tu žádné faktury nejsou"
        text="Propoj svůj fakturační systém. Načtu faktury za poslední rok a začnu hlídat splatnosti."
      >
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <InvoicingCta available={fakturoidAvailable} />
        </div>
      </ScreenEmpty>
    </div>
  );
}
