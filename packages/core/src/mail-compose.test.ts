import { describe, expect, it } from "vitest";

import {
  buildMimeMessage,
  mailDraftSchema,
  MAX_MAIL_RECIPIENTS,
  messageIdForAction,
  replySubject,
  toBase64Url,
  type ComposedMail,
} from "./mail-compose";

const compose = (overrides: Partial<ComposedMail> = {}): ComposedMail => ({
  from: { name: "Petr Dvořák", address: "petr@dvorak.test" },
  draft: {
    to: [{ name: "Jana Nová", address: "jana@novak.test" }],
    cc: [],
    subject: "Faktura č. 2026-0142",
    body: "Dobrý den,\nposílám fakturu.\n\nPetr",
  },
  messageId: "<bystro.a1@dvorak.test>",
  threading: null,
  date: new Date("2026-10-26T09:14:00Z"),
  ...overrides,
});

const headerOf = (raw: string, name: string) =>
  raw
    .split("\r\n\r\n")[0]
    ?.split("\r\n")
    .find((line) => line.startsWith(`${name}: `))
    ?.slice(name.length + 2);

const decodeWords = (value: string) =>
  value.replace(/=\?UTF-8\?B\?([^?]+)\?=\s?/g, (_whole, data: string) =>
    Buffer.from(data, "base64").toString("utf8"),
  );

describe("buildMimeMessage", () => {
  it("writes the headers with Czech names and subject encoded, and the body as UTF-8", () => {
    const raw = buildMimeMessage(compose());
    expect(headerOf(raw, "From")).toMatch(/^=\?UTF-8\?B\?.+\?= <petr@dvorak\.test>$/);
    expect(decodeWords(headerOf(raw, "From") ?? "")).toBe("Petr Dvořák<petr@dvorak.test>");
    expect(decodeWords(headerOf(raw, "Subject") ?? "")).toBe("Faktura č. 2026-0142");
    expect(headerOf(raw, "Date")).toBe("Mon, 26 Oct 2026 09:14:00 +0000");
    expect(headerOf(raw, "Message-ID")).toBe("<bystro.a1@dvorak.test>");
    expect(headerOf(raw, "Content-Type")).toBe('text/plain; charset="UTF-8"');
    expect(headerOf(raw, "In-Reply-To")).toBeUndefined();

    const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(
      "Dobrý den,\r\nposílám fakturu.\r\n\r\nPetr",
    );
    expect(raw.split("\r\n").every((line) => line.length <= 998)).toBe(true);
  });

  it("puts a reply into its thread with In-Reply-To and References", () => {
    const raw = buildMimeMessage(
      compose({
        threading: {
          threadExternalId: "t1",
          inReplyTo: "<b@mail.test>",
          references: ["<a@mail.test>"],
        },
      }),
    );
    expect(headerOf(raw, "In-Reply-To")).toBe("<b@mail.test>");
    expect(headerOf(raw, "References")).toBe("<a@mail.test> <b@mail.test>");
  });

  it("quotes plain names and keeps several recipients and copies", () => {
    const raw = buildMimeMessage(
      compose({
        from: { name: null, address: "petr@dvorak.test" },
        draft: {
          to: [
            { name: 'Novák "a syn"', address: "info@novak.test" },
            { name: null, address: "jana@novak.test" },
          ],
          cc: [{ name: "Eva", address: "eva@ucetni.test" }],
          subject: "Dotaz",
          body: "",
        },
      }),
    );
    expect(headerOf(raw, "From")).toBe("petr@dvorak.test");
    // A non-ASCII name is an encoded word (quotes inside it need no escaping).
    expect(decodeWords(headerOf(raw, "To") ?? "")).toBe(
      'Novák "a syn"<info@novak.test>, jana@novak.test',
    );
    expect(headerOf(raw, "Cc")).toBe('"Eva" <eva@ucetni.test>');
  });

  it("refuses line breaks that would inject headers", () => {
    expect(() =>
      buildMimeMessage(
        compose({
          draft: { ...compose().draft, subject: "Ahoj\r\nBcc: všichni@example.test" },
        }),
      ),
    ).toThrow();
    expect(() =>
      buildMimeMessage(
        compose({
          draft: {
            ...compose().draft,
            to: [{ name: "Jana\nBcc: x@y.test", address: "jana@novak.test" }],
          },
        }),
      ),
    ).toThrow();
  });
});

describe("mailDraftSchema", () => {
  const draft = compose().draft;

  it("accepts a normal draft and refuses empty, oversized or malformed ones", () => {
    expect(mailDraftSchema.safeParse(draft).success).toBe(true);
    expect(mailDraftSchema.safeParse({ ...draft, to: [] }).success).toBe(false);
    expect(mailDraftSchema.safeParse({ ...draft, subject: "  " }).success).toBe(false);
    expect(
      mailDraftSchema.safeParse({ ...draft, to: [{ name: null, address: "nesmysl" }] }).success,
    ).toBe(false);
    const many = Array.from({ length: MAX_MAIL_RECIPIENTS + 1 }, (_, index) => ({
      name: null,
      address: `a${index}@example.test`,
    }));
    expect(mailDraftSchema.safeParse({ ...draft, to: many }).success).toBe(false);
  });
});

describe("small helpers", () => {
  it("builds the reply subject without piling up Re:", () => {
    expect(replySubject("Faktura")).toBe("Re: Faktura");
    expect(replySubject("RE: Faktura")).toBe("RE: Faktura");
    expect(replySubject(null)).toBe("Re:");
  });

  it("derives the Message-ID from the action and the mailbox's domain", () => {
    expect(messageIdForAction("6f1c", "petr@dvorak.test")).toBe("<bystro.6f1c@dvorak.test>");
  });

  it("encodes the raw message as unpadded base64url", () => {
    expect(toBase64Url("ž?>")).toBe(Buffer.from("ž?>").toString("base64url"));
  });
});
