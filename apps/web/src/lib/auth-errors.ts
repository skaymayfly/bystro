const MESSAGES: Record<string, string> = {
  USER_ALREADY_EXISTS: "Účet s tímhle e-mailem už existuje. Zkus se přihlásit.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Účet s tímhle e-mailem už existuje. Zkus se přihlásit.",
  INVALID_EMAIL_OR_PASSWORD: "E-mail nebo heslo nesedí.",
  INVALID_EMAIL: "Tohle nevypadá jako e-mail.",
  INVALID_PASSWORD: "E-mail nebo heslo nesedí.",
  PASSWORD_TOO_SHORT: "Heslo musí mít aspoň 8 znaků.",
  PASSWORD_TOO_LONG: "Heslo je moc dlouhé. Zkus kratší.",
  INVALID_TOKEN: "Odkaz už neplatí. Požádej o nový.",
};

const TOO_MANY_REQUESTS = "Moc pokusů za sebou. Chvilku počkej a zkus to znovu.";
const FALLBACK = "Něco se nepovedlo. Zkus to prosím znovu.";

/** Turns a Better Auth error into a short Czech message for the user. */
export function authErrorMessage(
  error: { code?: string | undefined; status?: number | undefined } | null | undefined,
): string {
  if (error?.status === 429) {
    return TOO_MANY_REQUESTS;
  }
  return (error?.code !== undefined ? MESSAGES[error.code] : undefined) ?? FALLBACK;
}
