import { Mail } from "lucide-react";
import type { Metadata } from "next";

import { Card, PageHeader, ScreenEmpty, SoonBadge } from "@/components/bits";
import { ConnectForm } from "@/components/connections/connect-form";
import { ConnectOutcomeNotice, loadConnections } from "@/components/connections/connections-tab";
import { Button } from "@/components/ui/button";
import { requireRequestContext } from "@/server/context";

export const metadata: Metadata = { title: "Pošta – Bystro" };

/**
 * Pošta. Step 5.3 connects the mailbox; reading the mail (5.4, 5.5) and writing (5.6) come
 * next. Until then the screen says where the mailbox stands and nothing more.
 */
export default async function MailPage(props: PageProps<"/app/posta">) {
  const { organization } = await requireRequestContext();
  const query = await props.searchParams;
  const outcome = typeof query.propojeni === "string" ? query.propojeni : undefined;
  const { mailbox, mailAvailable } =
    organization === null
      ? { mailbox: null, mailAvailable: false }
      : await loadConnections(organization.id);

  if (mailbox === null || mailbox.status === "revoked") {
    return (
      <div className="flex flex-col gap-[22px]">
        <PageHeader title="Pošta" text="Doručené a odeslané e-maily na jednom místě" />
        <ConnectOutcomeNotice outcome={outcome} provider="gmail" />
        <ScreenEmpty
          icon={<Mail aria-hidden size={28} strokeWidth={1.6} />}
          title="E-mail zatím není propojený"
          text="Připoj Gmail. Poštu uvidíš tady, odpovídat budeš rovnou z Bystra a upomínky odejdou z tvé adresy."
        >
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {mailAvailable ? (
              <ConnectForm provider="gmail" returnTo="mail" label="Propojit e-mail" />
            ) : (
              <>
                <Button disabled>Propojit e-mail</Button>
                <SoonBadge />
              </>
            )}
          </div>
        </ScreenEmpty>
      </div>
    );
  }

  const needsReconnect = mailbox.status === "reauth_required";
  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader title="Pošta" text={`Gmail · ${mailbox.displayName ?? ""} · připojeno`} />
      <ConnectOutcomeNotice outcome={outcome} provider="gmail" />
      {needsReconnect ? (
        <Card className="items-start gap-3">
          <p className="text-[15px] font-medium">Gmail mi přestal dávat přístup</p>
          <p className="text-sm text-ink-3">
            Dokud je aplikace v testovacím režimu Googlu, přístup vyprší po týdnu. Připoj ho prosím
            znovu.
          </p>
          <ConnectForm provider="gmail" returnTo="mail" label="Znovu připojit" />
        </Card>
      ) : (
        <ScreenEmpty
          icon={<Mail aria-hidden size={28} strokeWidth={1.6} />}
          title="Schránka je propojená"
          text="Načítání pošty právě dokončujeme. Jakmile bude hotové, uvidíš tady doručené i odeslané e-maily."
        />
      )}
    </div>
  );
}
