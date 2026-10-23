import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthHeading, AuthShell, authStyles } from "@/components/auth-shell";
import { PillOptions, SoonBadge } from "@/components/bits";
import { ConnectOutcomeNotice, loadConnections } from "@/components/connections/connections-tab";
import { ProviderPicker } from "@/components/connections/provider-picker";
import { CompanyStep } from "@/components/onboarding/company-step";
import { buttonVariants } from "@/components/ui/button";
import { BRIEF_CHANNELS, BRIEF_TIMES, DEFAULT_BRIEF_TIME } from "@/lib/content";
import { describeInvoicingSources } from "@/lib/invoicing-providers";
import { cn } from "@/lib/utils";
import { APP_HOME_PATH } from "@/server/access";
import { requireRequestContext } from "@/server/context";

export const metadata: Metadata = { title: "Začínáme – Bystro" };

type Step = 1 | 2 | 3;
const STEPS: readonly Step[] = [1, 2, 3];

/** Heading and progress bars of a step, as in the prototype. */
function StepHeading({ step, title, text }: { step: Step; title: string; text: string }) {
  return (
    <>
      <AuthHeading title={title} text={text} className="mb-0" />
      <div className="my-7 flex gap-2" aria-hidden>
        {STEPS.map((n) => (
          <span
            key={n}
            className={cn("h-[3px] flex-1 rounded-full", n <= step ? "bg-ink" : "bg-line-strong")}
          />
        ))}
      </div>
    </>
  );
}

const fieldLabelClass = "pl-0.5 text-[15px] text-ink-2";

/** Step 2 from the prototype: connect the invoicing system (the bank comes with step 3.3). */
async function ConnectionsStep({
  organizationId,
  outcome,
  provider,
}: {
  organizationId: string;
  outcome: string | undefined;
  provider: string | undefined;
}) {
  const { invoicing, states } = await loadConnections(organizationId);
  const sources = describeInvoicingSources(invoicing);
  const connected = sources !== null;

  return (
    <>
      <StepHeading
        step={2}
        title="Co mám propojit?"
        text="Čím víc toho propojíš, tím přesnější bude ranní přehled. Přístup je jen pro čtení."
      />
      <div className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-card p-4 shadow-soft">
        <ConnectOutcomeNotice outcome={outcome} provider={provider} />
        <ProviderPicker
          states={states}
          returnTo="onboarding"
          className="grid-cols-5 sm:grid-cols-7"
        />
        {connected && (
          <div className="flex flex-col items-center gap-1 px-2 pt-2 pb-1 text-center">
            <p className="text-[17px] font-medium">{sources.connected}!</p>
            <p className="text-[13px] leading-normal text-ink-3">
              Nastavení propojení můžeš kdykoliv změnit v Nastavení → Propojení.
            </p>
          </div>
        )}
      </div>
      <Link href="/onboarding?krok=3" className={cn(buttonVariants({ size: "form" }), "mt-[34px]")}>
        {connected ? "Pokračovat" : "Teď přeskočit"}
      </Link>
    </>
  );
}

/** Step 3 from the prototype; the brief time is stored from step 6.6 on. */
function BriefStep() {
  return (
    <>
      <StepHeading
        step={3}
        title="Kdy ti mám posílat přehled?"
        text="Každý pracovní den ti pošlu jednu zprávu se vším důležitým."
      />
      <div className="flex flex-col gap-[22px]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className={fieldLabelClass}>Čas</p>
            <SoonBadge />
          </div>
          <PillOptions
            label="Čas ranního přehledu"
            options={BRIEF_TIMES}
            selected={DEFAULT_BRIEF_TIME}
            variant="boxes"
            size="lg"
          />
        </div>
        <div className="flex flex-col gap-2">
          <p className={fieldLabelClass}>Kam ho poslat</p>
          <PillOptions label="Kanál ranního přehledu" options={BRIEF_CHANNELS} variant="boxes" />
        </div>
      </div>
      <Link href={APP_HOME_PATH} className={cn(buttonVariants({ size: "form" }), "mt-[34px]")}>
        Začít používat
      </Link>
      <p className={cn(authStyles.hint, "mt-5")}>
        <Link href="/onboarding?krok=2" className={authStyles.link}>
          Zpět
        </Link>
      </p>
    </>
  );
}

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const { user, organization } = await requireRequestContext();
  const query = await props.searchParams;
  const requested = query.krok;
  const outcome = typeof query.propojeni === "string" ? query.propojeni : undefined;
  const outcomeProvider = typeof query.aplikace === "string" ? query.aplikace : undefined;

  // Without a company there is only step 1; with one, only steps 2 and 3 make sense.
  let step: Step = 1;
  if (organization !== null) {
    if (requested !== "2" && requested !== "3") {
      redirect(APP_HOME_PATH);
    }
    step = requested === "2" ? 2 : 3;
  }

  return (
    <AuthShell
      logoHref={organization === null ? "/onboarding" : APP_HOME_PATH}
      aside={<p className="text-sm text-ink-3">Krok {step} ze 3</p>}
      previewTitle={organization?.name ?? "Tvoje firma"}
      previewSubtitle={user.email}
    >
      {step === 1 && (
        <>
          <StepHeading
            step={1}
            title="Jak se jmenuje tvoje firma?"
            text="Podle IČO dohledám zbytek údajů, ať je nemusíš vypisovat."
          />
          <CompanyStep />
        </>
      )}
      {step === 2 && organization !== null && (
        <ConnectionsStep
          organizationId={organization.id}
          outcome={outcome}
          provider={outcomeProvider}
        />
      )}
      {step === 3 && <BriefStep />}
    </AuthShell>
  );
}
