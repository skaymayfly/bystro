export type NavIcon = "home" | "assistant" | "mail" | "cash" | "invoices" | "settings";

export interface NavItem {
  href: string;
  label: string;
  /** Shorter label for the mobile bottom bar. */
  shortLabel: string;
  icon: NavIcon;
  /** `main` = the list at the top of the sidebar, `footer` = pinned to its bottom (Revolut). */
  group: "main" | "footer";
}

/** Main navigation, in the order of the prototype (also the order of the mobile tab bar). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/app", label: "Přehled", shortLabel: "Přehled", icon: "home", group: "main" },
  {
    href: "/app/asistent",
    label: "Asistent",
    shortLabel: "Asistent",
    icon: "assistant",
    group: "main",
  },
  { href: "/app/posta", label: "Pošta", shortLabel: "Pošta", icon: "mail", group: "main" },
  {
    href: "/app/hlidac-penez",
    label: "Hlídač peněz",
    shortLabel: "Peníze",
    icon: "cash",
    group: "main",
  },
  {
    href: "/app/faktury",
    label: "Faktury",
    shortLabel: "Faktury",
    icon: "invoices",
    group: "main",
  },
  {
    href: "/app/nastaveni",
    label: "Nastavení",
    shortLabel: "Nastavení",
    icon: "settings",
    group: "footer",
  },
];

/** Whether a nav item should be highlighted for the current path. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/app") {
    return pathname === "/app";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Initials for the avatar, e.g. "Petr Dvořák" → "PD". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase("cs-CZ") || "?";
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Majitel",
  admin: "Správce",
  member: "Člen týmu",
};

/** Czech name of a membership role for the sidebar. */
export function roleLabel(role: string | null): string {
  return (role !== null ? ROLE_LABELS[role] : undefined) ?? "";
}
