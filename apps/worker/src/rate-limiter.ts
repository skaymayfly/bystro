import { decideRateLimit, type RateLimit, type RateLimitDecision } from "@bystro/core";
import type { Redis } from "ioredis";

/**
 * Thrown by a job handler when a provider's limit is used up. The job is not failed: it is
 * put back and runs again after `retryAfterMs`, without spending one of its attempts.
 */
export class RateLimitedError extends Error {
  override name = "RateLimitedError";
  readonly code = "rate_limited";

  constructor(readonly retryAfterMs: number) {
    super("Rate limit reached.");
  }
}

export interface RateLimiter {
  /**
   * Counts a call against the key and says whether it may go ahead. `cost` is how much of
   * the limit the call uses (1 by default; Gmail counts quota units, e.g. 60 for a message).
   */
  acquire(key: string, limit: RateLimit, cost?: number): Promise<RateLimitDecision>;
  /** Like {@link acquire}, but throws {@link RateLimitedError} when the limit is used up. */
  require(key: string, limit: RateLimit, cost?: number): Promise<void>;
}

/**
 * Atomic fixed-window counter: adds the call's cost, and the first call of a window starts
 * its timer. Returns the count including this call and the milliseconds until the window
 * ends.
 */
const COUNT_SCRIPT = `
local count = redis.call('INCRBY', KEYS[1], ARGV[2])
local ttl = redis.call('PTTL', KEYS[1])
if count == tonumber(ARGV[2]) or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * Rate limiter shared by all worker instances through Redis. The queue library can only
 * limit a whole queue, and limits are per provider (or per provider and connection, e.g.
 * one Fio token), so handlers ask here with the key from `rateLimitKey`.
 */
export function createRateLimiter(connection: Redis, prefix: string): RateLimiter {
  async function acquire(key: string, limit: RateLimit, cost = 1): Promise<RateLimitDecision> {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new RangeError("cost must be a positive integer");
    }
    const [count, remainingMs] = (await connection.eval(
      COUNT_SCRIPT,
      1,
      `${prefix}:rate-limit:${key}`,
      limit.windowMs,
      cost,
    )) as [number, number];
    return decideRateLimit(limit, count, remainingMs);
  }

  return {
    acquire,
    async require(key, limit, cost) {
      const decision = await acquire(key, limit, cost);
      if (!decision.allowed) {
        throw new RateLimitedError(decision.retryAfterMs);
      }
    },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits until a call of `cost` fits into the limit instead of giving up at once: for
 * limits with a short window (Gmail: a minute), where waiting inside the job is cheaper
 * than starting it again. Gives up with {@link RateLimitedError} after `maxWaitMs`.
 */
export async function waitForRateLimit(
  limiter: RateLimiter,
  key: string,
  limit: RateLimit,
  cost: number,
  options: { maxWaitMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const pause = options.sleep ?? sleep;
  let waited = 0;
  for (;;) {
    const decision = await limiter.acquire(key, limit, cost);
    if (decision.allowed) return;
    if (waited + decision.retryAfterMs > options.maxWaitMs) {
      throw new RateLimitedError(decision.retryAfterMs);
    }
    await pause(decision.retryAfterMs);
    waited += decision.retryAfterMs;
  }
}
