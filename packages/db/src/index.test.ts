import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "./index";

describe("@bystro/db", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@bystro/db");
  });
});
