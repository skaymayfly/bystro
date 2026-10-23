import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseTheme, THEME_SCRIPT, THEME_STORAGE_KEY } from "./theme";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** The custom properties declared in the first block that follows `selector`. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start + selector.length - 1);
  const close = css.indexOf("}", open);
  const values = new Map<string, string>();
  for (const match of css.slice(open + 1, close).matchAll(/(--bz-[\w-]+):\s*([^;]+);/g)) {
    values.set(match[1] as string, (match[2] as string).replace(/\s+/g, " ").trim());
  }
  return values;
}

const light = block(":root {");
const darkBySystem = block(':root:not([data-theme="light"]) {');
const darkByChoice = block(':root[data-theme="dark"] {');

function rgb(value: string, background?: [number, number, number]): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (rgba === null) throw new Error(`Unsupported colour ${value}`);
  const [r, g, b] = [rgba[1], rgba[2], rgba[3]].map(Number) as [number, number, number];
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  if (alpha === 1 || background === undefined) return [r, g, b];
  const [br, bg, bb] = background;
  return [r * alpha + br * (1 - alpha), g * alpha + bg * (1 - alpha), b * alpha + bb * (1 - alpha)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of a text colour on a background colour of the same palette. */
function contrast(palette: Map<string, string>, text: string, background: string): number {
  const bg = rgb(palette.get(background) as string);
  const fg = rgb(palette.get(text) as string, bg);
  const [high, low] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

describe("theme", () => {
  it("knows three choices and falls back to the system", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("<script>")).toBe("system");
  });

  it("sets only a known theme before the page is painted", () => {
    expect(THEME_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_SCRIPT).toContain('t==="light"||t==="dark"');
    expect(THEME_SCRIPT.startsWith("try{")).toBe(true);
  });
});

describe("palette", () => {
  it("has the same dark colours whether the system or the user chose dark", () => {
    expect(darkBySystem.size).toBeGreaterThan(30);
    expect([...darkByChoice.entries()]).toEqual([...darkBySystem.entries()]);
  });

  it("gives every light colour a dark counterpart", () => {
    const colours = [...light.keys()].filter((name) => !name.startsWith("--bz-shadow"));
    for (const name of colours) {
      expect(darkBySystem.has(name), name).toBe(true);
    }
  });

  it.each([
    ["light", light],
    ["dark", darkBySystem],
  ])("keeps text readable in %s mode (WCAG AA)", (_mode, palette) => {
    // Body text and secondary text on the page and on cards.
    for (const background of ["--bz-bg", "--bz-surface"]) {
      expect(contrast(palette, "--bz-text", background)).toBeGreaterThanOrEqual(7);
      expect(contrast(palette, "--bz-text-2", background)).toBeGreaterThanOrEqual(7);
      expect(contrast(palette, "--bz-text-muted", background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette, "--bz-accent", background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette, "--bz-danger-strong", background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette, "--bz-success-strong", background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette, "--bz-warning-strong", background)).toBeGreaterThanOrEqual(4.5);
    }
    // The label of the blue main button.
    expect(contrast(palette, "--bz-cta-text", "--bz-cta")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette, "--bz-cta-text", "--bz-cta-hover")).toBeGreaterThanOrEqual(4.5);
  });
});
