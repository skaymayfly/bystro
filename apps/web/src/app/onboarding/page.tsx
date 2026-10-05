import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo, PillOptions, SoonBadge } from "@/components/bits";
import { CompanyStep } from "@/components/onboarding/company-step";
import { buttonVariants } from "@/components/ui/button";
import {
  BRIEF_CHANNELS,
  BRIEF_TIMES,
  CONNECTION_CATEGORIES,
  DEFAULT_BRIEF_TIME,
} from "@/lib/content";
import { cn } from "@/lib/utils";
import { APP_HOME_PATH } from "@/server/access";
import { requireRequestContext } from "@/server/context";

export const metadata: Metadata = { title: "Začínáme – Bystro" };

type Step = 1 | 2 | 3;

function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex gap-1.5" role="img" aria-label={`Krok ${step} ze 3`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            "h-2 rounded-full transition-all",
            n === step ? "w-8" : "w-2",
            n <= step ? "bg-brand" : "bg-line-strong",
          )}
        />
      ))}
    </div>
  );
}

function StepHeading({ step, title, text }: { step: Step; title: string; text?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[13px] font-semibold text-ink-3">Krok {step} ze 3</p>
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-4xl">
        {title}
      </h1>
      {text !== undefined && <p className="text-base leading-normal text-ink-2">{text}</p>}
    </div>
  );
}

/** Step 2 from the prototype; connecting sources arrives with steps 2.6 and 3.3. */
function ConnectionsStep() {
  return (
    <>
      <StepHeading
        step={2}
        title="Co mám propojit?"
        text="Čím víc toho propojíš, tím přesnější bude ranní přehled. Kdykoliv to změníš v nastavení."
      />
      <ul className="flex flex-col gap-2">
        {CONNECTION_CATEGORIES.map((category) => (
          <li
            key={category.name}
            className="flex items-center gap-4 rounded-tile bg-muted px-[18px] py-4"
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
      <div className="flex justify-end pt-2">
        <Link href="/onboarding?krok=3" className={buttonVariants({ size: "lg" })}>
          Teď přeskočit
        </Link>
      </div>
    </>
  );
}

/** Step 3 from the prototype; the brief time is stored from step 6.6 on. */
function BriefStep() {
  return (
    <>
      <StepHeading step={3} title="Kdy ti mám posílat ranní přehled?" />
      <div className="flex flex-col gap-3">
        <PillOptions
          label="Čas ranního přehledu"
          options={BRIEF_TIMES}
          selected={DEFAULT_BRIEF_TIME}
          tone="plain"
        />
        <div>
          <SoonBadge />
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <p className="text-sm font-semibold text-ink-2">Kam ho poslat?</p>
        <PillOptions label="Kanál ranního přehledu" options={BRIEF_CHANNELS} tone="plain" />
      </div>
      <div className="flex justify-between gap-2.5 pt-2">
        <Link
          href="/onboarding?krok=2"
          className={buttonVariants({ variant: "secondary", size: "lg" })}
        >
          Zpět
        </Link>
        <Link href={APP_HOME_PATH} className={buttonVariants({ size: "lg" })}>
          Začít používat
        </Link>
      </div>
    </>
  );
}

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const { organization } = await requireRequestContext();
  const requested = (await props.searchParams).krok;

  // Without a company there is only step 1; with one, only steps 2 and 3 make sense.
  let step: Step = 1;
  if (organization !== null) {
    if (requested !== "2" && requested !== "3") {
      redirect(APP_HOME_PATH);
    }
    step = requested === "2" ? 2 : 3;
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 p-4 sm:p-6">
      <div className="flex w-full max-w-[760px] items-center justify-between">
        <Logo href={organization === null ? "/onboarding" : APP_HOME_PATH} />
        <StepDots step={step} />
      </div>
      <main className="flex w-full max-w-[760px] flex-col gap-7 rounded-panel bg-card p-6 sm:p-11">
        {step === 1 && <CompanyStep />}
        {step === 2 && <ConnectionsStep />}
        {step === 3 && <BriefStep />}
      </main>
    </div>
  );
}
