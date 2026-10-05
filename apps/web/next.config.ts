import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, so Next.js compiles them.
  transpilePackages: ["@bystro/core", "@bystro/db", "@bystro/integrations", "@bystro/ai"],
};

export default nextConfig;
