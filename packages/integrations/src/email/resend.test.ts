import type { EmailMessage } from "@bystro/core";
import { describe, expect, it } from "vitest";

import { EmailSendError, ResendEmailSender } from "./resend";

const API_KEY = "re_test_secret_key";
const message: EmailMessage = {
  to: "petr@example.cz",
  subject: "Obnova hesla",
  text: "Ahoj, tady je odkaz.",
  html: "<p>Ahoj, tady je odkaz.</p>",
  replyTo: "podpora@example.cz",
  idempotencyKey: "reset-123",
};

/** Builds a fake `fetch` that records the request and answers with the given fixture. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

function sender(fetchFn: typeof fetch) {
  return new ResendEmailSender({
    apiKey: API_KEY,
    from: "Bystro <noreply@example.cz>",
    fetch: fetchFn,
  });
}

describe("ResendEmailSender", () => {
  it("posts the message to the Resend API and returns the message id", async () => {
    // Success body as documented in the Resend API reference.
    const { calls, fetchFn } = fakeFetch(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });

    const result = await sender(fetchFn).send(message);

    expect(result).toEqual({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "reset-123",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      from: "Bystro <noreply@example.cz>",
      to: ["petr@example.cz"],
      subject: "Obnova hesla",
      text: "Ahoj, tady je odkaz.",
      html: "<p>Ahoj, tady je odkaz.</p>",
      reply_to: "podpora@example.cz",
    });
  });

  it("omits optional fields that are not set", async () => {
    const { calls, fetchFn } = fakeFetch(200, { id: "abc" });

    await sender(fetchFn).send({ to: "a@example.cz", subject: "S", text: "T" });

    expect(Object.keys(JSON.parse(String(calls[0]?.init.body))).sort()).toEqual([
      "from",
      "subject",
      "text",
      "to",
    ]);
    expect(calls[0]?.init.headers).not.toHaveProperty("Idempotency-Key");
  });

  it("throws EmailSendError with the status when Resend rejects the e-mail", async () => {
    // Error body in the shape Resend uses (statusCode, name, message).
    const { fetchFn } = fakeFetch(422, {
      statusCode: 422,
      name: "validation_error",
      message: "Invalid `to` field: petr@example.cz",
    });

    const error = await sender(fetchFn)
      .send(message)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).status).toBe(422);
    expect((error as EmailSendError).message).toContain("validation_error");
  });

  it("never leaks the API key, recipient or body in error messages", async () => {
    const { fetchFn } = fakeFetch(403, {
      name: "invalid_api_key",
      message: `API key ${API_KEY} is invalid for petr@example.cz`,
    });

    const error = (await sender(fetchFn)
      .send(message)
      .catch((caught: unknown) => caught)) as Error;

    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain("petr@example.cz");
    expect(error.message).not.toContain("odkaz");
  });

  it("throws EmailSendError on a network failure", async () => {
    const failing = (async () => {
      throw new TypeError(`fetch failed for key ${API_KEY}`);
    }) as unknown as typeof fetch;

    const error = (await sender(failing)
      .send(message)
      .catch((caught: unknown) => caught)) as Error;

    expect(error).toBeInstanceOf(EmailSendError);
    expect(error.message).not.toContain(API_KEY);
  });

  it("throws when the success response has no id", async () => {
    const { fetchFn } = fakeFetch(200, { ok: true });
    await expect(sender(fetchFn).send(message)).rejects.toBeInstanceOf(EmailSendError);
  });

  it("refuses to be constructed without credentials", () => {
    expect(() => new ResendEmailSender({ apiKey: "", from: "x@example.cz" })).toThrow();
    expect(() => new ResendEmailSender({ apiKey: API_KEY, from: "" })).toThrow();
  });
});
