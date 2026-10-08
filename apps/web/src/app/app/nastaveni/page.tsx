import { formatCzk } from "@bystro/core";
import { Bell, Link2, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  CardTitle,
  PageHeader,
  PillOptions,
  ProviderTiles,
  SoonBadge,
} from "@/components/bits";
import { Input } from "@/components/ui/input";
import {
  BRIEF_CHANNELS,
  BRIEF_CONTENTS,
  BRIEF_TIMES,
  CASH_THRESHOLDS_MINOR,
  DEFAULT_BRIEF_TIME,
  DEFAULT_TONE,
  PROVIDERS,
  TONE_OPTIONS,
} from "@/lib/content";
import { initials, roleLabel } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { requireRequestContext, type RequestContext } from "@/server/context";

export const metadata: Metadata = { title: "Nastavení – Bystro" };

const TABS = [
  { key: "profil", label: "Profil", icon: User },
  { key: "propojeni", label: "Propojení", icon: Link2 },
  { key: "upozorneni", label: "Upozornění", icon: Bell },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const fieldLabelClass = "flex flex-col gap-2 text-[13px] text-ink-3";
const fieldClass = "h-[50px] rounded-box text-[15px]";

/** Who is signed in and for which company. Read-only: editing is not built yet. */
function ProfileTab({ context }: { context: RequestContext }) {
  const { user, organization, role } = context;
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-[18px]">
          <span className="flex size-[72px] flex-none items-center justify-center rounded-full bg-ink text-2xl font-bold text-white">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[22px] font-medium tracking-[-0.02em]">{user.name}</p>
            <p className="text-sm text-ink-3">
              {roleLabel(role)} · {organization?.name}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3.5">
          <label className={fieldLabelClass}>
            Jméno a příjmení
            <Input disabled className={fieldClass} defaultValue={user.name} />
          </label>
          <label className={fieldLabelClass}>
            E-mail
            <Input disabled className={fieldClass} defaultValue={user.email} />
          </label>
          <label className={fieldLabelClass}>
            Název firmy
            <Input disabled className={fieldClass} defaultValue={organization?.name} />
          </label>
          <label className={fieldLabelClass}>
            IČO
            <Input disabled className={fieldClass} defaultValue={organization?.ico} />
          </label>
        </div>
        <p className="text-[13px] text-ink-3">Úpravu údajů teprve chystáme.</p>
      </Card>

      <Card>
        <CardTitle
          text="Ovlivní ranní přehled, odpovědi asistenta i návrhy e-mailů klientům."
          aside={<SoonBadge />}
        >
          Jak spolu mluvíme
        </CardTitle>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2.5">
          {TONE_OPTIONS.map((option) => {
            const selected = option.name === DEFAULT_TONE;
            return (
              <div
                key={option.name}
                className={cn(
                  "flex flex-col gap-1.5 rounded-[18px] border bg-muted p-4",
                  selected ? "border-ink-2" : "border-line-strong",
                )}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[15px] font-semibold">{option.name}</p>
                  <span
                    aria-hidden
                    className={cn(
                      "size-[18px] rounded-full border-2 shadow-[inset_0_0_0_3px_#fff]",
                      selected ? "border-ink-2 bg-ink-2" : "border-line-dark",
                    )}
                  />
                </div>
                <p className="text-[13px] leading-[1.45] text-ink-2">{option.example}</p>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

const connectionPanelClass = "min-w-0 rounded-[18px] border border-line bg-card shadow-soft";

/** The prototype's app picker; connecting arrives with steps 2.6 and 3.3. */
function ConnectionsTab() {
  return (
    <div className="flex flex-wrap items-start gap-3.5">
      <section
        className={cn(
          connectionPanelClass,
          "flex max-w-[420px] flex-[1_1_320px] flex-col gap-3.5 p-[18px]",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[17px] font-medium">Přidat aplikaci</h2>
            <p className="mt-[3px] text-sm text-ink-3">Přístup je vždy jen pro čtení.</p>
          </div>
          <SoonBadge />
        </div>
        <ProviderTiles providers={PROVIDERS} className="grid-cols-5" />
      </section>
      <section className={cn(connectionPanelClass, "flex-[2_1_360px] overflow-hidden")}>
        <div className="flex items-baseline justify-between border-b border-line-soft px-[18px] py-4">
          <h2 className="text-[17px] font-medium">Propojené aplikace</h2>
          <p className="text-[13px] text-ink-3">0 z {PROVIDERS.length}</p>
        </div>
        <p className="px-[18px] py-9 text-center text-sm text-ink-3">
          Zatím nic. Propojení teprve chystáme.
        </p>
      </section>
    </div>
  );
}

/** Morning brief and cash warning settings from the prototype; none of them is stored yet. */
function NotificationsTab() {
  return (
    <>
      <Card>
        <CardTitle
          text="Jedna zpráva každý pracovní den. Víkendy tě nechám v klidu."
          aside={<SoonBadge />}
        >
          Ranní přehled
        </CardTitle>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-[18px]">
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] text-ink-3">Čas</p>
            <PillOptions
              label="Čas ranního přehledu"
              options={BRIEF_TIMES}
              selected={DEFAULT_BRIEF_TIME}
            />
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] text-ink-3">Kam ho poslat</p>
            <PillOptions label="Kanál ranního přehledu" options={BRIEF_CHANNELS} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-ink-3">Co má obsahovat</p>
          {BRIEF_CONTENTS.map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-3.5 rounded-tile bg-muted px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">{item.name}</p>
                <p className="text-[13px] text-ink-3">{item.example}</p>
              </div>
              <span
                aria-hidden
                className="relative h-7 w-[46px] flex-none rounded-full bg-line-dark"
              >
                <span className="absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white" />
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle
          text="Upozorním tě hned, jak předpověď zůstatku klesne pod tuto hranici."
          aside={<SoonBadge />}
        >
          Hlídač peněz
        </CardTitle>
        <PillOptions
          label="Hranice upozornění"
          options={CASH_THRESHOLDS_MINOR.map((amount) => formatCzk(amount))}
        />
      </Card>
    </>
  );
}

/** Nastavení: the prototype's tabs. The plan tab arrives with billing (phase 9). */
export default async function SettingsPage(props: PageProps<"/app/nastaveni">) {
  const context = await requireRequestContext();
  const requested = (await props.searchParams).karta;
  const active: TabKey = TABS.find((tab) => tab.key === requested)?.key ?? "profil";

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader title="Nastavení" text="Profil, propojení a jak často se ti mám ozývat." />

      <div className="flex flex-wrap items-start gap-3.5">
        <nav
          aria-label="Části nastavení"
          className="flex max-w-full min-w-0 flex-[1_1_240px] flex-col gap-1 rounded-card border border-line bg-card p-2.5 md:max-w-[300px]"
        >
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={tab.key === "profil" ? "/app/nastaveni" : `/app/nastaveni?karta=${tab.key}`}
              aria-current={tab.key === active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-box px-3.5 py-3 text-[15px] font-medium hover:bg-fill",
                tab.key === active ? "bg-line-soft text-ink" : "text-ink-2",
              )}
            >
              <tab.icon aria-hidden size={18} strokeWidth={1.7} />
              {tab.label}
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5">
          {active === "profil" && <ProfileTab context={context} />}
          {active === "propojeni" && <ConnectionsTab />}
          {active === "upozorneni" && <NotificationsTab />}
        </div>
      </div>
    </div>
  );
}
