import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads the repository-root `.env` for local scripts and tests.
 * Variables already present in the environment win, so CI and hosting are unaffected.
 */
export function loadRootEnv(): void {
  const rootEnvFile = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(rootEnvFile)) {
    process.loadEnvFile(rootEnvFile);
  }
}
