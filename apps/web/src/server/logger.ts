import { createLogger } from "@bystro/observability";

/** The web server's logger; output is redacted (see @bystro/observability). */
export const logger = createLogger({ service: "web" });
