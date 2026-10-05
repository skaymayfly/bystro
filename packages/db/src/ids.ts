import { z } from "zod";

const uuid = z.uuid();

/** Thrown when an ID argument is missing or not a UUID. */
export class InvalidIdError extends Error {
  override name = "InvalidIdError";
}

/** Returns the value if it is a UUID, otherwise throws {@link InvalidIdError}. */
export function requireUuid(value: unknown, label: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw new InvalidIdError(`${label} must be a UUID.`);
  }
  return parsed.data;
}
