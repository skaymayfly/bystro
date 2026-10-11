"use client";

import Image from "next/image";
import { useId, useState } from "react";

import fakturoidLogo from "@/assets/fakturoid-logo.svg";
import { SoonBadge } from "@/components/bits";
import { PROVIDERS } from "@/lib/content";
import { cn } from "@/lib/utils";

import { ConnectForm, type ConnectReturnTarget } from "./connect-form";

/**
 * - `connect`: Fakturoid can be connected now.
 * - `connected`: the company already has it connected.
 * - `unavailable`: this environment has no Fakturoid application configured.
 */
export type FakturoidState = "connect" | "connected" | "unavailable";

/** What the prototype lists before connecting an invoicing system. */
const FAKTUROID_REQUIREMENTS = [
  "Účet ve Fakturoidu",
  "Přihlášení u Fakturoidu",
  "Právo číst faktury a kontakty",
];

/**
 * The prototype's "add an app" picker: a grid of provider tiles, and under it the panel of
 * the provider that was clicked. Only Fakturoid has a panel so far; the other tiles are
 * not available yet. The panel is closed until its tile is clicked.
 */
export function ProviderPicker({
  fakturoid,
  returnTo,
  className,
}: {
  fakturoid: FakturoidState;
  returnTo: ConnectReturnTarget;
  /** Grid columns of the tiles, e.g. `grid-cols-5`. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <ul className={cn("grid gap-2", className)}>
        {PROVIDERS.map((provider) =>
          provider.logo === "fakturoid" ? (
            // Fakturoid's logo rules (https://www.fakturoid.cz/logo): the symbol never without
            // the name, the horizontal logo at least 30 px high, unaltered, on a calm
            // background. The file already contains the required clear space. Hence a tile
            // two columns wide, in full colour.
            <li key={provider.name} className="col-span-2 flex">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                title={provider.name}
                onClick={() => setOpen((current) => !current)}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center rounded-xl border bg-white px-1 transition-colors outline-none hover:border-ink-2 focus-visible:shadow-focus",
                  open ? "border-ink" : "border-line",
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
            <li
              key={provider.name}
              title={provider.name}
              className="flex aspect-square items-center justify-center rounded-xl text-base font-bold tracking-[-0.02em] opacity-60"
              style={{ background: provider.background, color: provider.color }}
            >
              <span aria-hidden>{provider.mark}</span>
              <span className="sr-only">{provider.name}</span>
            </li>
          ),
        )}
      </ul>

      {open ? (
        <div id={panelId} className="flex flex-col gap-3 border-t border-line-soft pt-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-medium">Fakturoid</p>
            {fakturoid === "unavailable" && <SoonBadge />}
          </div>
          {fakturoid === "connect" && (
            <>
              <p className="text-sm text-ink-3">Požadavky:</p>
              <ul className="flex flex-col gap-2 pl-0.5">
                {FAKTUROID_REQUIREMENTS.map((requirement) => (
                  <li key={requirement} className="flex items-baseline gap-2.5 text-sm">
                    <span
                      aria-hidden
                      className="size-1 flex-none -translate-y-[3px] rounded-full bg-ink"
                    />
                    {requirement}
                  </li>
                ))}
              </ul>
              <ConnectForm returnTo={returnTo} size="form" className="mt-1" />
            </>
          )}
          {fakturoid === "connected" && (
            <p className="text-sm text-ink-2">
              Fakturoid je propojený. Stav a odpojení najdeš v seznamu propojených aplikací.
            </p>
          )}
          {fakturoid === "unavailable" && (
            <p className="text-sm text-ink-2">Propojení s Fakturoidem teprve chystáme.</p>
          )}
          {/* Required by Fakturoid's rules for third-party apps that show its logo. */}
          <p className="text-xs leading-normal text-ink-3">
            Fakturoid je samostatná placená služba, kterou provozuje Fakturoid s.r.o. Propojení s ní
            vyvíjí Bystro.
          </p>
        </div>
      ) : (
        <p className="text-center text-[13px] leading-normal text-ink-3">
          Klikni na aplikaci a uvidíš, co je potřeba.
        </p>
      )}
    </>
  );
}
