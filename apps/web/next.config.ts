import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

// The shared .env lives in the repository root; Next.js itself only reads apps/web/.env*.
// Variables already present in the environment win, so CI and hosting are unaffected.
const rootEnvFile = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, so Next.js compiles them.
  transpilePackages: [
    "@bystro/core",
    "@bystro/db",
    "@bystro/integrations",
    "@bystro/ai",
    "@bystro/observability",
  ],
};

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Source maps are not uploaded yet; that needs a Sentry auth token (deployment, step 1.8).
  sourcemaps: { disable: true },
});
