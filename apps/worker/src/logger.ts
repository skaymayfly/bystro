import { createLogger } from "@bystro/observability";

/** The worker's logger; output is redacted (see @bystro/observability). */
export const logger = createLogger({ service: "worker" });
