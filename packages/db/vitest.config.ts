import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one database with the other packages, which run at the same
    // time; under that load a query can take seconds.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup-env.ts"],
  },
});
