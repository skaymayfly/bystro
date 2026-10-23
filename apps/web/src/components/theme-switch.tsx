"use client";

import { useEffect, useState } from "react";

import { SEGMENTED_BAR, segmentClass } from "@/components/bits";
import { parseTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

const OPTIONS: { theme: Theme; label: string }[] = [
  { theme: "system", label: "Podle systému" },
  { theme: "light", label: "Světlý" },
  { theme: "dark", label: "Tmavý" },
];

/** Applies a theme to the page at once and remembers it in this browser. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
  try {
    if (theme === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Storage blocked (private window): the choice holds until the page is left.
  }
}

/** Nastavení → Profil → Vzhled: system, light or dark. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      setTheme(parseTheme(localStorage.getItem(THEME_STORAGE_KEY)));
    } catch {
      // Storage blocked: the default stays.
    }
  }, []);

  return (
    <div role="radiogroup" aria-label="Vzhled" className={SEGMENTED_BAR}>
      {OPTIONS.map((option) => (
        <button
          key={option.theme}
          type="button"
          role="radio"
          aria-checked={theme === option.theme}
          onClick={() => {
            setTheme(option.theme);
            applyTheme(option.theme);
          }}
          className={segmentClass(theme === option.theme)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
