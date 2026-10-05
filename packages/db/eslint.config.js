import base, { restrictWorkspaceImports } from "@bystro/config/eslint/base";

export default [
  ...base,
  restrictWorkspaceImports(
    ["@bystro/integrations", "@bystro/ai"],
    "packages/db may only depend on packages/core (see CLAUDE.md).",
  ),
];
