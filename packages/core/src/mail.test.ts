import { describe, expect, it } from "vitest";

import {
  applyLabelChange,
  decodeEncodedWords,
  extractMailText,
  foldMailHistory,
  headerValue,
  htmlToText,
  isDiscardedMail,
  isMailInScope,
  mailWindowStart,
  MAX_MAIL_BODY_CHARS,
  parseAddressList,
  parseMessageIds,
  trackedLabels,
  type MimePart,
} from "./mail";

const b64url = (text: string, encoding: BufferEncoding = "utf8") =>
  Buffer.from(text, encoding).toString("base64url");

const part = (overrides: Partial<MimePart>): MimePart => ({
  mimeType: "text/plain",
  headers: [],
  filename: null,
  data: null,
  hasExternalBody: false,
  parts: [],
  ...overrides,
});

describe("mailWindowStart", () => {
  it("reaches exactly 30 days back", () => {
    expect(mailWindowStart(new Date("2026-10-31T12:00:00Z")).toISOString()).toBe(
      "2026-10-01T12:00:00.000Z",
    );
  });
});

describe("labels", () => {
  it("keeps only the tracked system labels, once, in a stable order", () => {
    expect(trackedLabels(["Label_12", "UNREAD", "INBOX", "IMPORTANT", "INBOX"])).toEqual([
      "INBOX",
      "UNREAD",
    ]);
  });

  it("takes in Doručené and Odeslané, not drafts, trash or spam", () => {
    expect(isMailInScope(["INBOX"])).toBe(true);
    expect(isMailInScope(["SENT"])).toBe(true);
    expect(isMailInScope(["CATEGORY_PROMOTIONS"])).toBe(false);
    expect(isMailInScope(["DRAFT", "SENT"])).toBe(false);
    expect(isMailInScope(["INBOX", "TRASH"])).toBe(false);
    expect(isMailInScope(["INBOX", "SPAM"])).toBe(false);
  });

  it("discards trashed and spam messages", () => {
    expect(isDiscardedMail(["TRASH"])).toBe(true);
    expect(isDiscardedMail(["SPAM", "UNREAD"])).toBe(true);
    expect(isDiscardedMail(["INBOX"])).toBe(false);
  });

  it("applies a label change to the current set", () => {
    expect(
      applyLabelChange(["INBOX", "UNREAD", "Label_1"], {
        add: new Set(["SENT"] as const),
        remove: new Set(["INBOX", "UNREAD"] as const),
      }),
    ).toEqual(["SENT"]);
  });
});

describe("headers", () => {
  it("finds a header regardless of case", () => {
    expect(headerValue([{ name: "Subject", value: "Faktura" }], "subject")).toBe("Faktura");
    expect(headerValue([], "From")).toBeNull();
  });

  it("decodes encoded words in Base64 and quoted-printable, also in Czech charsets", () => {
    expect(decodeEncodedWords("=?UTF-8?B?RmFrdHVyYSDEjS4gMjAyNi0wMTQy?=")).toBe(
      "Faktura č. 2026-0142",
    );
    expect(decodeEncodedWords("=?iso-8859-2?Q?P=F8ipom=EDnka_faktury?=")).toBe(
      "Připomínka faktury",
    );
    // Whitespace between two encoded words disappears, other text stays.
    expect(decodeEncodedWords("Re: =?utf-8?Q?Dob?= =?utf-8?Q?r=C3=BD_den?=")).toBe("Re: Dobrý den");
    expect(decodeEncodedWords("Obyčejný předmět")).toBe("Obyčejný předmět");
  });

  it("reads address lists with names, quotes, commas and comments", () => {
    expect(
      parseAddressList(
        '"Nová, Jana" <Jana@Example.cz>, petr@dvorak.cz, Lenka Horáková <lenka@horakova.cz>, info@firma.cz (Firma)',
      ),
    ).toEqual([
      { name: "Nová, Jana", address: "jana@example.cz" },
      { name: null, address: "petr@dvorak.cz" },
      { name: "Lenka Horáková", address: "lenka@horakova.cz" },
      { name: "Firma", address: "info@firma.cz" },
    ]);
  });

  it("decodes encoded names, flattens groups and drops what is not an address", () => {
    expect(
      parseAddressList(
        "=?utf-8?Q?Pek=C3=A1rna?= <pekarna@example.cz>, Tým: a@x.cz, b@x.cz;, nesmysl",
      ),
    ).toEqual([
      { name: "Pekárna", address: "pekarna@example.cz" },
      { name: null, address: "a@x.cz" },
      { name: null, address: "b@x.cz" },
    ]);
    expect(parseAddressList(null)).toEqual([]);
  });

  it("reads message ids from References", () => {
    expect(parseMessageIds("<a@mail.gmail.com>\r\n <b@example.cz> ")).toEqual([
      "<a@mail.gmail.com>",
      "<b@example.cz>",
    ]);
    expect(parseMessageIds(null)).toEqual([]);
  });
});

describe("htmlToText", () => {
  it("keeps visible text only: no tags, scripts, styles or link targets", () => {
    const html = `<html><head><title>x</title><style>p{color:red}</style></head>
      <body><p>Dobrý&nbsp;den,</p><script>alert(1)</script>
      <p>fakturu najdete <a href="https://evil.example">tady</a>.</p>
      <ul><li>položka</li></ul><!-- skryté --></body></html>`;
    expect(htmlToText(html)).toBe("Dobrý den,\nfakturu najdete tady.\n• položka");
  });

  it("decodes named and numeric entities", () => {
    expect(htmlToText("&bdquo;Ahoj&ldquo; &amp; &#269;au &#x10D;au &lt;b&gt;")).toBe(
      "„Ahoj“ & čau čau <b>",
    );
  });
});

describe("extractMailText", () => {
  it("prefers the plain-text alternative", () => {
    const root = part({
      mimeType: "multipart/alternative",
      parts: [
        part({ mimeType: "text/plain", data: b64url("Dobrý den,\r\nposílám fakturu.") }),
        part({ mimeType: "text/html", data: b64url("<p>HTML verze</p>") }),
      ],
    });
    expect(extractMailText(root)).toEqual({
      text: "Dobrý den,\nposílám fakturu.",
      hasAttachments: false,
    });
  });

  it("falls back to HTML reduced to text and notes attachments without reading them", () => {
    const root = part({
      mimeType: "multipart/mixed",
      parts: [
        part({ mimeType: "text/html", data: b64url("<div>Jen HTML</div>") }),
        part({
          mimeType: "application/pdf",
          filename: "faktura.pdf",
          hasExternalBody: true,
        }),
      ],
    });
    expect(extractMailText(root)).toEqual({ text: "Jen HTML", hasAttachments: true });
  });

  it("decodes the charset named in Content-Type", () => {
    const root = part({
      headers: [{ name: "Content-Type", value: 'text/plain; charset="windows-1250"' }],
      // "Žluťoučký kůň" in windows-1250
      data: Buffer.from([
        0x8e, 0x6c, 0x75, 0x9d, 0x6f, 0x75, 0xe8, 0x6b, 0xfd, 0x20, 0x6b, 0xf9, 0xf2,
      ]).toString("base64url"),
    });
    expect(extractMailText(root).text).toBe("Žluťoučký kůň");
  });

  it("skips a text attachment and survives a broken part", () => {
    const root = part({
      mimeType: "multipart/mixed",
      parts: [
        part({ data: "@@@not base64@@@" }),
        part({
          headers: [{ name: "Content-Disposition", value: 'attachment; filename="poznamka.txt"' }],
          data: b64url("tajná příloha"),
        }),
      ],
    });
    expect(extractMailText(root)).toEqual({ text: "", hasAttachments: true });
  });

  it("cuts off very long bodies", () => {
    const root = part({ data: b64url("a".repeat(MAX_MAIL_BODY_CHARS + 50)) });
    expect(extractMailText(root).text).toHaveLength(MAX_MAIL_BODY_CHARS);
  });
});

describe("foldMailHistory", () => {
  const record = (overrides: Partial<Parameters<typeof foldMailHistory>[0][number]>) => ({
    added: [],
    deleted: [],
    labelsAdded: [],
    labelsRemoved: [],
    ...overrides,
  });

  it("collects new messages, label changes and deletions", () => {
    const changes = foldMailHistory([
      record({ added: [{ id: "m1", labels: ["INBOX", "UNREAD", "CATEGORY_UPDATES"] }] }),
      record({ labelsRemoved: [{ id: "m0", labels: ["INBOX"] }] }),
      record({ deleted: ["m9"] }),
    ]);
    expect([...changes.added]).toEqual([["m1", ["INBOX", "UNREAD"]]]);
    expect(changes.labelChanges.get("m0")).toEqual({ add: new Set(), remove: new Set(["INBOX"]) });
    expect([...changes.deleted]).toEqual(["m9"]);
  });

  it("lets a later record win", () => {
    const changes = foldMailHistory([
      record({ labelsAdded: [{ id: "m0", labels: ["UNREAD"] }] }),
      record({ labelsRemoved: [{ id: "m0", labels: ["UNREAD"] }] }),
    ]);
    expect(changes.labelChanges.get("m0")).toEqual({
      add: new Set(),
      remove: new Set(["UNREAD"]),
    });
  });

  it("gives a message added in the batch its final labels", () => {
    const changes = foldMailHistory([
      record({ added: [{ id: "m1", labels: ["INBOX", "UNREAD"] }] }),
      record({ labelsRemoved: [{ id: "m1", labels: ["UNREAD", "INBOX"] }] }),
    ]);
    expect(changes.added.get("m1")).toEqual([]);
    expect(changes.labelChanges.has("m1")).toBe(false);
  });

  it("drops everything about a message deleted later in the batch", () => {
    const changes = foldMailHistory([
      record({ added: [{ id: "m1", labels: ["INBOX"] }] }),
      record({ labelsAdded: [{ id: "m1", labels: ["UNREAD"] }] }),
      record({ deleted: ["m1"] }),
    ]);
    expect(changes.added.size).toBe(0);
    expect(changes.labelChanges.size).toBe(0);
    expect([...changes.deleted]).toEqual(["m1"]);
  });
});
