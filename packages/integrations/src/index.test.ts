import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "./index";

describe("@bystro/integrations", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@bystro/integrations");
  });
});
