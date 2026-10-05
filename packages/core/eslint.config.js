import base, { restrictWorkspaceImports } from "@bystro/config/eslint/base";

export default [
  ...base,
  restrictWorkspaceImports(
    ["@bystro/db", "@bystro/integrations", "@bystro/ai"],
    "packages/core must not depend on other workspace packages (see CLAUDE.md).",
  ),
];
