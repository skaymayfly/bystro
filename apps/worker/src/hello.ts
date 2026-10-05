import { PACKAGE_NAME as CORE_PACKAGE_NAME } from "@bystro/core";

/** Startup message; also proves that workspace packages resolve from the worker. */
export function helloMessage(): string {
  return `Bystro worker: hello (${CORE_PACKAGE_NAME} loaded)`;
}
