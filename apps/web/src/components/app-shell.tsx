"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { initials, isNavItemActive, NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { Logo, LogoMark, Wordmark } from "./bits";
import { NavIcon } from "./nav-icon";
import { SignOutButton } from "./sign-out-button";

interface AppShellProps {
  userName: string;
  userEmail: string;
  userRole: string;
  organizationName: string;
  /** Today in words ("čtvrtek 23. října 2026"), formatted on the server in Europe/Prague. */
  today: string;
  children: ReactNode;
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      title={item.label}
      className={cn(
        "flex h-10 items-center justify-center gap-3 rounded-control text-sm font-medium transition-colors min-[1100px]:justify-start min-[1100px]:px-3",
        active ? "bg-chip text-ink" : "text-ink-3 hover:bg-fill hover:text-ink",
      )}
    >
      <NavIcon name={item.icon} size={18} className={active ? "text-link" : undefined} />
      <span className="hidden flex-1 truncate min-[1100px]:inline">{item.label}</span>
    </Link>
  );
}

/** The company as a pill with its initials, where Revolut Business shows its business switcher. */
function CompanyPill({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 max-w-[260px] min-w-0 items-center gap-2 rounded-full border border-line bg-card py-1 pr-3.5 pl-1 text-[13px] font-medium shadow-soft",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-7 flex-none items-center justify-center rounded-full bg-chip text-[11px] font-semibold text-ink-2"
      >
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * Application frame after Revolut Business: the sidebar and the top bar sit on the grey
 * stage, the content lies on it in white cards. The sidebar narrows to icons below
 * 1100 px; below 768 px there is a top bar and a bottom tab bar instead.
 */
export function AppShell({
  userName,
  userEmail,
  userRole,
  organizationName,
  today,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const mainItems = NAV_ITEMS.filter((item) => item.group === "main");
  const footerItems = NAV_ITEMS.filter((item) => item.group === "footer");

  return (
    <div className="flex min-h-screen bg-chrome">
      <aside className="sticky top-0 hidden h-screen w-[72px] flex-none flex-col overflow-y-auto px-3 py-5 md:flex min-[1100px]:w-[232px] min-[1100px]:px-4">
        <Link
          href="/app"
          aria-label="Bystro – Přehled"
          className="flex h-10 items-center justify-center gap-2.5 min-[1100px]:justify-start min-[1100px]:px-2"
        >
          <LogoMark className="size-8" />
          <Wordmark className="hidden text-xl min-[1100px]:inline" />
        </Link>

        <nav aria-label="Hlavní navigace" className="mt-7 flex flex-1 flex-col gap-0.5">
          {mainItems.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isNavItemActive(pathname, item.href)}
            />
          ))}
          <div className="mt-auto flex flex-col gap-0.5 pt-4">
            {footerItems.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                active={isNavItemActive(pathname, item.href)}
              />
            ))}
          </div>
        </nav>

        <div className="mt-3 flex flex-col items-center gap-2 border-t border-line-soft pt-4 min-[1100px]:flex-row min-[1100px]:gap-2.5 min-[1100px]:px-1">
          <span
            title={userName}
            className="flex size-9 flex-none items-center justify-center rounded-full bg-ink text-xs font-semibold text-on-ink"
          >
            {initials(userName)}
          </span>
          <span className="hidden min-w-0 flex-1 min-[1100px]:block">
            <span className="block truncate text-[13px] font-medium">{userName}</span>
            <span className="block truncate text-xs text-ink-3">{userRole}</span>
            <span className="block truncate text-xs text-ink-4">{userEmail}</span>
          </span>
          <SignOutButton className="text-[11px] min-[1100px]:text-xs" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-chrome/85 px-4 backdrop-blur-md md:h-16 md:px-8">
          <span className="md:hidden">
            <Logo href="/app" />
          </span>
          <p className="hidden truncate text-[13px] text-ink-3 first-letter:uppercase md:block">
            {today}
          </p>
          <div className="flex min-w-0 items-center gap-2">
            <CompanyPill name={organizationName} className="hidden sm:inline-flex" />
            <SignOutButton className="text-sm md:hidden" />
          </div>
        </header>

        <main className="min-w-0 flex-1">
          {/* Keyed by the address, so that every screen fades in as on libraries.dev. */}
          <div
            key={pathname}
            className="page-in mx-auto w-full max-w-[1280px] px-4 pt-1 pb-28 sm:px-6 md:px-8 md:pt-2 md:pb-12"
          >
            {children}
          </div>
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
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium",
                active ? "text-link" : "text-ink-3",
              )}
            >
              <NavIcon name={item.icon} />
              <span className="truncate">{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
