"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import { initials, isNavItemActive, NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { Logo } from "./bits";

interface AppShellProps {
  userName: string;
  /** Name of the active organization, or `null` before the user creates one. */
  organizationName: string | null;
  children: ReactNode;
}

function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await authClient.signOut();
    router.push("/prihlaseni");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Odhlásit"
      className={cn("cursor-pointer p-1 text-xs text-ink-3 hover:text-ink", className)}
    >
      Odejít
    </button>
  );
}

/**
 * Application frame from the prototype: a sidebar from tablet width up.
 * The prototype has no mobile layout, so small screens get a top bar and a bottom tab bar.
 */
export function AppShell({ userName, organizationName, children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[236px] flex-none flex-col gap-5 py-5 pr-3.5 pl-5 md:flex">
        <div className="px-2 py-1.5">
          <Logo href="/app" />
        </div>
        <nav aria-label="Hlavní navigace" className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-full px-3.5 py-3 text-[15px] font-medium transition-colors",
                  active ? "bg-card text-ink" : "text-ink-2 hover:bg-card/60",
                )}
              >
                <span className={cn("size-2 rounded-full", active ? "bg-brand" : "bg-dot")} />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 rounded-3xl bg-card p-3.5">
          <span className="flex size-[38px] flex-none items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong">
            {initials(userName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-sm font-semibold break-words">{userName}</span>
            <span className="line-clamp-2 text-xs break-words text-ink-3">
              {organizationName ?? "Firma zatím není založená"}
            </span>
          </span>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-4 pt-4 md:hidden">
          <Logo href="/app" />
          <SignOutButton className="text-sm" />
        </header>
        <main className="min-w-0 flex-1 px-4 pt-4 pb-28 md:py-5 md:pr-5 md:pb-10 md:pl-1.5">
          {children}
        </main>
      </div>

      <nav
        aria-label="Hlavní navigace"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line bg-card px-1 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-semibold",
                active ? "text-ink" : "text-ink-3",
              )}
            >
              <span className={cn("size-2 rounded-full", active ? "bg-brand" : "bg-dot")} />
              <span className="truncate">{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
