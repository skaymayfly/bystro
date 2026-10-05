import type { EmailMessage, EmailSender } from "@bystro/core";

// API reference: https://resend.com/docs/api-reference/emails/send-email
const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Thrown when an e-mail could not be handed over to the provider.
 * Carries only the HTTP status and the provider's error name: never the API key,
 * the recipient or the message body.
 */
export class EmailSendError extends Error {
  override name = "EmailSendError";

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface ResendEmailSenderOptions {
  apiKey: string;
  /** Sender, e.g. `Bystro <noreply@example.cz>`. The domain must be verified in Resend. */
  from: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Sends e-mails through the Resend HTTP API. */
export class ResendEmailSender implements EmailSender {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: typeof fetch;

  constructor(options: ResendEmailSenderOptions) {
    if (options.apiKey === "" || options.from === "") {
      throw new Error("ResendEmailSender requires an API key and a sender address.");
    }
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#fetch = options.fetch ?? fetch;
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
    };
    if (message.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = message.idempotencyKey;
    }

    let response: Response;
    try {
      response = await this.#fetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: this.#from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
          ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new EmailSendError("Resend request failed (network error or timeout).");
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const errorName =
        typeof body === "object" && body !== null && "name" in body && typeof body.name === "string"
          ? body.name
          : "unknown_error";
      throw new EmailSendError(
        `Resend rejected the e-mail (${response.status} ${errorName}).`,
        response.status,
      );
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("id" in body) ||
      typeof body.id !== "string"
    ) {
      throw new EmailSendError("Resend returned an unexpected response.", response.status);
    }
    return { id: body.id };
  }
}
