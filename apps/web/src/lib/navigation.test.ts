import { describe, expect, it } from "vitest";

import { greeting, initials, isNavItemActive, NAV_ITEMS } from "./navigation";

describe("navigation", () => {
  it("lists the five sections in prototype order", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Přehled",
      "Asistent",
      "Hlídač peněz",
      "Faktury",
      "Nastavení",
    ]);
  });

  it("highlights Přehled only on the app home", () => {
    expect(isNavItemActive("/app", "/app")).toBe(true);
    expect(isNavItemActive("/app/faktury", "/app")).toBe(false);
  });

  it("highlights a section on its page and its sub-pages", () => {
    expect(isNavItemActive("/app/faktury", "/app/faktury")).toBe(true);
    expect(isNavItemActive("/app/faktury/FV-1", "/app/faktury")).toBe(true);
    expect(isNavItemActive("/app/faktury-archiv", "/app/faktury")).toBe(false);
    expect(isNavItemActive("/app/nastaveni", "/app/faktury")).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first letters of the first and last word", () => {
    expect(initials("Petr Dvořák")).toBe("PD");
    expect(initials("  jana   marie  nováková ")).toBe("JN");
    expect(initials("Čeněk Šíma")).toBe("ČŠ");
  });

  it("handles single words and empty names", () => {
    expect(initials("Petr")).toBe("P");
    expect(initials("")).toBe("?");
  });
});

describe("greeting", () => {
  it("depends on the hour", () => {
    expect(greeting(6)).toBe("Dobré ráno.");
    expect(greeting(9)).toBe("Dobré ráno.");
    expect(greeting(10)).toBe("Dobrý den.");
    expect(greeting(17)).toBe("Dobrý den.");
    expect(greeting(18)).toBe("Dobrý večer.");
    expect(greeting(23)).toBe("Dobrý večer.");
  });
});
