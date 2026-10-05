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
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);

/**
 * Forbids importing the given workspace packages.
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
