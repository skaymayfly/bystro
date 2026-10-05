import { REDACTED } from "./redaction";

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

/**
 * Wraps a sensitive value (token, client secret, PKCE verifier) so that it cannot leak by
 * accident: serializing, printing or logging the wrapper yields `[redacted]`. The only way
 * to get the value is the explicit `reveal()` at the point where it is really needed.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Returns the real value. Use only where it is handed to the provider or encrypted. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspectSymbol](): string {
    return REDACTED;
  }
}
