"use client";

import Image from "next/image";
import { useId, useState } from "react";

import fakturoidLogo from "@/assets/fakturoid-logo.svg";
import { SoonBadge } from "@/components/bits";
import { PROVIDERS } from "@/lib/content";
import {
  INVOICING_PROVIDERS,
  providerWording,
  type InvoicingProviderId,
} from "@/lib/invoicing-providers";
import { cn } from "@/lib/utils";

import { ConnectForm, type ConnectReturnTarget } from "./connect-form";

/**
 * - `connect`: the application can be connected now.
 * - `connected`: the company already has it connected.
 * - `unavailable`: this environment has no application configured for it.
 */
export type ProviderState = "connect" | "connected" | "unavailable";
export type ProviderStates = Record<InvoicingProviderId, ProviderState>;

interface PanelContent {
  /** What the prototype lists before connecting an invoicing system. */
  requirements: readonly string[];
  /** Who runs the service; for Fakturoid required by its rules for apps showing its logo. */
  note: string;
}

const PANELS: Record<InvoicingProviderId, PanelContent> = {
  fakturoid: {
    requirements: [
      "Účet ve Fakturoidu",
      "Přihlášení u Fakturoidu",
      "Právo číst faktury a kontakty",
    ],
    note: "Fakturoid je samostatná placená služba, kterou provozuje Fakturoid s.r.o. Propojení s ní vyvíjí Bystro.",
  },
  idoklad: {
    requirements: [
      "Účet v iDokladu",
      "Přihlášení u iDokladu",
      "Tarif iDokladu, který dovoluje přístup přes API",
    ],
    note: "iDoklad je samostatná služba, kterou provozuje Seyfor, a. s. Propojení s ní vyvíjí Bystro.",
  },
};

/**
 * The prototype's "add an app" picker: a grid of provider tiles, and under it the panel of
 * the provider that was clicked. Invoicing systems have a panel; the other tiles are not
 * available yet. The panel is closed until a tile is clicked.
 */
export function ProviderPicker({
  states,
  returnTo,
  className,
}: {
  states: ProviderStates;
  returnTo: ConnectReturnTarget;
  /** Grid columns of the tiles, e.g. `grid-cols-5`. */
  className?: string;
}) {
  const [open, setOpen] = useState<InvoicingProviderId | null>(null);
  const panelId = useId();
  const toggle = (provider: InvoicingProviderId) =>
    setOpen((current) => (current === provider ? null : provider));

  const app = open === null ? null : providerWording(open);
  const state = open === null ? null : states[open];
  // Another invoicing system that is already connected: the same invoice kept in both
  // would be counted twice, which the user should know before connecting.
  const alreadyConnected =
    open === null
      ? []
      : INVOICING_PROVIDERS.filter(
          (provider) => provider !== open && states[provider] === "connected",
        );

  return (
    <>
      <ul className={cn("grid gap-2", className)}>
        {PROVIDERS.map((provider) => {
          const id = provider.connect;
          if (id === undefined) {
            return (
              <li
                key={provider.name}
                title={provider.name}
                className="flex aspect-square items-center justify-center rounded-xl text-base font-bold tracking-[-0.02em] opacity-60"
                style={{ background: provider.background, color: provider.color }}
              >
                <span aria-hidden>{provider.mark}</span>
                <span className="sr-only">{provider.name}</span>
              </li>
            );
          }
          const buttonProps = {
            type: "button" as const,
            "aria-expanded": open === id,
            "aria-controls": panelId,
            title: provider.name,
            onClick: () => toggle(id),
          };
          return provider.logo === "fakturoid" ? (
            // Fakturoid's logo rules (https://www.fakturoid.cz/logo): the symbol never without
            // the name, the horizontal logo at least 30 px high, unaltered, on a calm
            // background. The file already contains the required clear space. Hence a tile
            // two columns wide, in full colour.
            <li key={provider.name} className="col-span-2 flex">
              <button
                {...buttonProps}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center rounded-xl border bg-white px-1 transition-colors outline-none hover:border-ink-2 focus-visible:shadow-focus",
                  open === id ? "border-ink" : "border-line",
                )}
              >
                <Image
                  src={fakturoidLogo}
                  alt={provider.name}
                  unoptimized
                  className="h-auto max-h-full w-full max-w-[132px] min-w-[88px]"
                />
              </button>
            </li>
          ) : (
            // No logo file we may use: the prototype's letter mark, as a button.
            <li key={provider.name} className="flex">
              <button
                {...buttonProps}
                aria-label={provider.name}
                className={cn(
                  "flex aspect-square flex-1 cursor-pointer items-center justify-center rounded-xl border-2 text-base font-bold tracking-[-0.02em] transition-colors outline-none focus-visible:shadow-focus",
                  open === id ? "border-ink" : "border-transparent hover:border-ink-2",
                )}
                style={{ background: provider.background, color: provider.color }}
              >
                <span aria-hidden>{provider.mark}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {open !== null && app !== null && state !== null ? (
        <div id={panelId} className="flex flex-col gap-3 border-t border-line-soft pt-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-medium">{app.name}</p>
            {state === "unavailable" && <SoonBadge />}
          </div>
          {state === "connect" && (
            <>
              <p className="text-sm text-ink-3">Požadavky:</p>
              <ul className="flex flex-col gap-2 pl-0.5">
                {PANELS[open].requirements.map((requirement) => (
                  <li key={requirement} className="flex items-baseline gap-2.5 text-sm">
                    <span
                      aria-hidden
                      className="size-1 flex-none -translate-y-[3px] rounded-full bg-ink"
                    />
                    {requirement}
                  </li>
                ))}
              </ul>
              {alreadyConnected.length > 0 && (
                <p className="rounded-box border border-line-strong bg-subtle px-3 py-2.5 text-[13px] leading-normal text-ink-2">
                  Už máš propojený{" "}
                  {alreadyConnected.map((id) => providerWording(id).name).join(" a ")}. Faktury,
                  které máš v obou systémech, bych ukazoval a počítal dvakrát.
                </p>
              )}
              <ConnectForm provider={open} returnTo={returnTo} size="form" className="mt-1" />
            </>
          )}
          {state === "connected" && (
            <p className="text-sm text-ink-2">
              {app.name} je propojený. Stav a odpojení najdeš v seznamu propojených aplikací.
            </p>
          )}
          {state === "unavailable" && (
            <p className="text-sm text-ink-2">Propojení {app.withIt} teprve chystáme.</p>
          )}
          <p className="text-xs leading-normal text-ink-3">{PANELS[open].note}</p>
        </div>
      ) : (
        <p className="text-center text-[13px] leading-normal text-ink-3">
          Klikni na aplikaci a uvidíš, co je potřeba.
        </p>
      )}
    </>
  );
}
