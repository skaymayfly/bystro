import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit runs from packages/db; the shared .env lives in the repository root.
const rootEnvFile = "../../.env";
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
