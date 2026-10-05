import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Shared ESLint config for every package and app in the monorepo. */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Logs go through the redacting logger from @bystro/observability.
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Command-line scripts and test tooling talk to a terminal, not to the log pipeline.
    files: ["**/scripts/**", "**/e2e/**", "**/*.config.*"],
    rules: { "no-console": "off" },
  },
  prettier,
);

/**
 * Rules for apps (web, worker): no direct database access. Queries live in @bystro/db,
 * where tenant data is only reachable through functions that take an organizationId.
 */
export const noDirectDatabaseAccess = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["drizzle-orm", "drizzle-orm/*", "pg", "pg/*"],
            message:
              "Apps must not query the database directly. Use the functions exported from @bystro/db (see CLAUDE.md).",
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.property.name='execute']",
        message:
          "Raw SQL is not allowed in apps. Add a function to @bystro/db that takes an organizationId.",
      },
      {
        selector: "MemberExpression[property.name='$client']",
        message:
          "Do not reach for the underlying database client in apps. Use the functions exported from @bystro/db.",
      },
    ],
  },
};

/**
 * Forbids importing the given packages (and their subpaths).
 * Enforces the dependency rules from CLAUDE.md (e.g. `core` depends on nothing).
 */
export function restrictWorkspaceImports(forbidden, message) {
  return {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: forbidden.flatMap((name) => [name, `${name}/*`]),
              message,
            },
          ],
        },
      ],
    },
  };
}
