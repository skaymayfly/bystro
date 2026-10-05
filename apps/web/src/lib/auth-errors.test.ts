import { describe, expect, it } from "vitest";

import { authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it("translates known Better Auth error codes", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      "E-mail nebo heslo nesedí.",
    );
    expect(authErrorMessage({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toContain(
      "už existuje",
    );
    expect(authErrorMessage({ code: "PASSWORD_TOO_SHORT" })).toContain("aspoň 8 znaků");
    expect(authErrorMessage({ code: "INVALID_TOKEN" })).toContain("Odkaz už neplatí");
  });

  it("explains rate limiting", () => {
    expect(authErrorMessage({ status: 429 })).toContain("Moc pokusů");
  });

  it("falls back to a generic message for unknown or missing errors", () => {
    const fallback = "Něco se nepovedlo. Zkus to prosím znovu.";
    expect(authErrorMessage({ code: "SOMETHING_NEW" })).toBe(fallback);
    expect(authErrorMessage({})).toBe(fallback);
    expect(authErrorMessage(null)).toBe(fallback);
    expect(authErrorMessage(undefined)).toBe(fallback);
  });
});
