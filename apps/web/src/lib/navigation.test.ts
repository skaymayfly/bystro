import { describe, expect, it } from "vitest";

import { initials, isNavItemActive, NAV_ITEMS, roleLabel } from "./navigation";

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

  it("splits the sections into the two sidebar groups of the prototype", () => {
    expect(NAV_ITEMS.filter((item) => item.group === 1).map((item) => item.label)).toEqual([
      "Přehled",
      "Asistent",
      "Hlídač peněz",
    ]);
    expect(NAV_ITEMS.filter((item) => item.group === 2).map((item) => item.label)).toEqual([
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

describe("roleLabel", () => {
  it("names the membership roles in Czech", () => {
    expect(roleLabel("owner")).toBe("Majitel");
    expect(roleLabel("admin")).toBe("Správce");
    expect(roleLabel("member")).toBe("Člen týmu");
  });

  it("is empty without a role or for an unknown one", () => {
    expect(roleLabel(null)).toBe("");
    expect(roleLabel("stranger")).toBe("");
  });
});
