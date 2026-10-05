import { describe, expect, it } from "vitest";

import { helloMessage } from "./hello";

describe("helloMessage", () => {
  it("greets and confirms that @bystro/core is resolvable", () => {
    expect(helloMessage()).toBe("Bystro worker: hello (@bystro/core loaded)");
  });
});
