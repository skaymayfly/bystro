export type ComponentStatus = "ok" | "down";

export interface HealthReport {
  status: ComponentStatus;
  database: ComponentStatus;
  redis: ComponentStatus;
}

const DEFAULT_TIMEOUT_MS = 2_000;

/** Runs a check and treats a rejection, a `false` or a timeout as "down". */
async function probe(check: () => Promise<boolean>, timeoutMs: number): Promise<ComponentStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return (await Promise.race([check(), timeout])) ? "ok" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks the services the web app cannot work without. The report says only which part is
 * up or down: no addresses, versions or error messages, because the endpoint is public.
 */
export async function checkHealth(
  checks: { database: () => Promise<boolean>; redis: () => Promise<boolean> },
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<HealthReport> {
  const [database, redis] = await Promise.all([
    probe(checks.database, timeoutMs),
    probe(checks.redis, timeoutMs),
  ]);
  return { status: database === "ok" && redis === "ok" ? "ok" : "down", database, redis };
}
