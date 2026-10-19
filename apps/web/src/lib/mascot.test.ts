import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MASCOT_MOODS, mascotDimensions, mascotLabel } from "./mascot";

const css = readFileSync(new URL("../components/mascot/mascot.css", import.meta.url), "utf8");

describe("mascot", () => {
  it("has a label for screen readers in every state", () => {
    const labels = MASCOT_MOODS.map(mascotLabel);
    expect(labels.every((label) => label.startsWith("Bystrouš"))).toBe(true);
    // Each state sounds different.
    expect(new Set(labels).size).toBe(MASCOT_MOODS.length);
    expect(mascotLabel("sleep")).toBe("Bystrouš spí");
  });

  it("keeps the proportions of the drawing in the design's sizes", () => {
    expect(mascotDimensions("sm")).toEqual({ width: 56, height: 62 });
    expect(mascotDimensions("md")).toEqual({ width: 88, height: 97 });
    expect(mascotDimensions("lg")).toEqual({ width: 160, height: 176 });
  });

  it("styles every state, and only inside the mascot", () => {
    for (const mood of MASCOT_MOODS.filter((item) => item !== "idle")) {
      expect(css).toContain(`.masc.m-${mood}`);
    }
    // Every rule (inside @media too, keyframes aside) is scoped to the mascot.
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      .match(/[^{}]+(?=\{)/g)
      ?.map((chunk) => chunk.trim())
      .filter((chunk) => !chunk.startsWith("@"))
      .flatMap((chunk) => chunk.split(",").map((selector) => selector.trim()));
    expect(selectors?.length).toBeGreaterThan(50);
    for (const selector of selectors ?? []) {
      expect(selector.startsWith(".masc") && !/^.masc[w-]/.test(selector)).toBe(true);
    }
  });

  it("stops moving for users who ask for reduced motion", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.masc \* \{\s*animation: none !important;/,
    );
  });
});
