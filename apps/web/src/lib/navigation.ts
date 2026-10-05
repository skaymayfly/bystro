export interface NavItem {
  href: string;
  label: string;
  /** Shorter label for the mobile bottom bar. */
  shortLabel: string;
}

/** Main navigation, in the order of the prototype. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/app", label: "Přehled", shortLabel: "Přehled" },
  { href: "/app/asistent", label: "Asistent", shortLabel: "Asistent" },
  { href: "/app/hlidac-penez", label: "Hlídač peněz", shortLabel: "Peníze" },
  { href: "/app/faktury", label: "Faktury", shortLabel: "Faktury" },
  { href: "/app/nastaveni", label: "Nastavení", shortLabel: "Nastavení" },
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

/** Greeting by the hour in Europe/Prague. */
export function greeting(hour: number): string {
  if (hour < 10) {
    return "Dobré ráno.";
  }
  return hour < 18 ? "Dobrý den." : "Dobrý večer.";
}
