import { defineConfig } from "tsup";

/**
 * Bundles the migration CLI into one self-contained file for the deployed image, where
 * there is no workspace and no node_modules for this package. The SQL files are shipped
 * next to it and located through MIGRATIONS_DIR.
 */
export default defineConfig({
  entry: { migrate: "src/scripts/migrate.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  splitting: false,
  // Everything is inlined except the optional native driver, which pg loads only if present.
  noExternal: [/.*/],
  external: ["pg-native"],
});
