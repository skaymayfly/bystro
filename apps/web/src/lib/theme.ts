/** Light or dark appearance. `system` follows the operating system's setting. No I/O. */

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** Where the choice is kept in the browser (it is a preference, not data). */
export const THEME_STORAGE_KEY = "bystro-theme";

export function parseTheme(value: unknown): Theme {
  return THEMES.find((theme) => theme === value) ?? "system";
}

/**
 * Runs in <head> before the page is painted, so that a chosen theme never flashes in the
 * other one. Only `light` and `dark` set an attribute; without one the CSS follows the system.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
