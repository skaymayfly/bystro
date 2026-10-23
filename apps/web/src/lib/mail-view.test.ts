import { describe, expect, it } from "vitest";

import {
  addressLabel,
  formatMailDateTime,
  formatMailTime,
  mailHref,
  parseMailFolder,
} from "./mail-view";

describe("mail addresses", () => {
  it("reads the folder from the address and falls back to Doručené", () => {
    expect(parseMailFolder("odeslane")).toBe("sent");
    expect(parseMailFolder("dorucene")).toBe("inbox");
    expect(parseMailFolder(undefined)).toBe("inbox");
    expect(parseMailFolder("cokoli")).toBe("inbox");
  });

  it("builds the address of a folder, search and thread", () => {
    expect(mailHref({ folder: "inbox" })).toBe("/app/posta");
    expect(mailHref({ folder: "sent", query: "  faktura ", thread: "18f2" })).toBe(
      "/app/posta?slozka=odeslane&q=faktura&vlakno=18f2",
    );
    expect(mailHref({ folder: "inbox", query: "Novák & syn" })).toBe(
      "/app/posta?q=Nov%C3%A1k+%26+syn",
    );
  });
});

describe("mail times", () => {
  const now = new Date("2026-10-24T10:00:00Z");

  it("shows only the time for today, in Prague time", () => {
    expect(formatMailTime(new Date("2026-10-24T07:14:00Z"), now)).toBe("9:14");
    // 23:30 UTC on the 23rd is already the 24th in Prague.
    expect(formatMailTime(new Date("2026-10-23T22:30:00Z"), now)).toBe("0:30");
  });

  it("shows day and month this year and adds the year before", () => {
    expect(formatMailTime(new Date("2026-10-22T08:00:00Z"), now)).toBe("22. 10.");
    expect(formatMailTime(new Date("2025-12-30T08:00:00Z"), now)).toBe("30. 12. 2025");
  });

  it("gives the full date and time in the detail", () => {
    expect(formatMailDateTime(new Date("2026-10-22T07:05:00Z"))).toBe("22. 10. 2026 9:05");
  });

  it("names a person by display name, else by address", () => {
    expect(addressLabel({ name: "Jana Nová", address: "jana@example.test" })).toBe("Jana Nová");
    expect(addressLabel({ name: null, address: "jana@example.test" })).toBe("jana@example.test");
    expect(addressLabel(null)).toBe("Neznámý odesílatel");
  });
});
