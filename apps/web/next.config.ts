import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const repositoryRoot = resolve(process.cwd(), "../..");

// The shared .env lives in the repository root; Next.js itself only reads apps/web/.env*.
// Variables already present in the environment win, so CI and hosting are unaffected.
const rootEnvFile = resolve(repositoryRoot, ".env");
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

// The container image runs the self-contained server (see apps/web/Dockerfile).
// `next start`, used locally and in E2E, does not work with standalone output.
const standalone = process.env.NEXT_OUTPUT_STANDALONE === "1";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, so Next.js compiles them.
  transpilePackages: [
    "@bystro/core",
    "@bystro/db",
    "@bystro/integrations",
    "@bystro/ai",
    "@bystro/observability",
  ],
  ...(standalone ? { output: "standalone" as const, outputFileTracingRoot: repositoryRoot } : {}),
};

// Source maps are uploaded to Sentry only when a build has the credentials for it.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const sentryOrg = process.env.SENTRY_ORG?.trim();
const sentryProject = process.env.SENTRY_PROJECT?.trim();
const uploadSourceMaps = Boolean(sentryAuthToken && sentryOrg && sentryProject);

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  ...(uploadSourceMaps
    ? {
        org: sentryOrg as string,
        project: sentryProject as string,
        authToken: sentryAuthToken as string,
        sourcemaps: { deleteSourcemapsAfterUpload: true },
      }
    : { sourcemaps: { disable: true } }),
});
