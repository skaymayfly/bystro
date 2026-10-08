"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { initials, isNavItemActive, NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { Logo, LogoMark } from "./bits";
import { NavIcon } from "./nav-icon";
import { SignOutButton } from "./sign-out-button";

interface AppShellProps {
  userName: string;
  userEmail: string;
  userRole: string;
  organizationName: string;
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
        "flex items-center justify-center gap-3.5 rounded-xl py-[11px] text-base transition-colors hover:bg-muted min-[1000px]:-mx-3 min-[1000px]:justify-start min-[1000px]:px-3",
        active ? "bg-card text-ink hover:bg-card" : "text-ink-2",
      )}
    >
      <NavIcon name={item.icon} className={active ? "text-ink" : "text-ink-3"} />
      <span className="hidden flex-1 min-[1000px]:inline">{item.label}</span>
    </Link>
  );
}

/**
 * Application frame from the prototype: a grey sidebar and a white content sheet with a
 * rounded top-left corner. The sidebar narrows to icons below 1000 px, as in the prototype.
 * The prototype has no phone layout, so below 768 px there is a top bar and a bottom tab bar.
 */
export function AppShell({
  userName,
  userEmail,
  userRole,
  organizationName,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const groups = [1, 2].map((group) => NAV_ITEMS.filter((item) => item.group === group));

  return (
    <div className="flex min-h-screen bg-chrome">
      <aside className="sticky top-0 hidden h-screen w-[84px] flex-none flex-col overflow-y-auto px-5 py-6 md:flex min-[1000px]:w-[288px] min-[1000px]:px-[30px] min-[1000px]:pt-[30px]">
        <Link
          href="/app"
          className="flex items-center justify-center gap-3 min-[1000px]:justify-start"
        >
          <LogoMark className="size-10" />
          <span className="hidden min-w-0 flex-1 min-[1000px]:block">
            <span className="block truncate text-lg font-semibold tracking-[-0.02em]">
              {organizationName}
            </span>
            <span className="block truncate text-[13px] text-ink-3">{userEmail}</span>
          </span>
        </Link>

        <nav aria-label="Hlavní navigace" className="mt-[30px] flex flex-col">
          {groups.map((items, index) => (
            <div
              key={items[0]?.href}
              className={cn(
                "flex flex-col gap-0.5 border-line-soft py-4",
                index === 0 && "border-y",
              )}
            >
              {items.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isNavItemActive(pathname, item.href)}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-3 border-t border-line-soft pt-4 min-[1000px]:flex-row">
          <span className="flex size-10 flex-none items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
            {initials(userName)}
          </span>
          <span className="hidden min-w-0 flex-1 min-[1000px]:block">
            <span className="block truncate text-sm font-medium">{userName}</span>
            <span className="block truncate text-xs text-ink-3">{userRole}</span>
          </span>
          <SignOutButton className="text-[11px] min-[1000px]:text-[13px]" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-4 py-3 md:hidden">
          <Logo href="/app" />
          <SignOutButton className="text-sm" />
        </header>
        <main className="min-w-0 flex-1 border-t border-line bg-card md:mt-3 md:rounded-tl-panel md:border-l">
          <div className="mx-auto w-full max-w-[1440px] px-4 pt-2 pb-28 sm:px-6 md:px-10 md:pt-7 md:pb-12">
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
                active ? "text-ink" : "text-ink-3",
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
