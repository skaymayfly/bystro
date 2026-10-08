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
  /** Counts one call against the key and says whether it may go ahead. */
  acquire(key: string, limit: RateLimit): Promise<RateLimitDecision>;
  /** Like {@link acquire}, but throws {@link RateLimitedError} when the limit is used up. */
  require(key: string, limit: RateLimit): Promise<void>;
}

/**
 * Atomic fixed-window counter: the first call of a window starts its timer. Returns the
 * count including this call and the milliseconds until the window ends.
 */
const COUNT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
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
  async function acquire(key: string, limit: RateLimit): Promise<RateLimitDecision> {
    const [count, remainingMs] = (await connection.eval(
      COUNT_SCRIPT,
      1,
      `${prefix}:rate-limit:${key}`,
      limit.windowMs,
    )) as [number, number];
    return decideRateLimit(limit, count, remainingMs);
  }

  return {
    acquire,
    async require(key, limit) {
      const decision = await acquire(key, limit);
      if (!decision.allowed) {
        throw new RateLimitedError(decision.retryAfterMs);
      }
    },
  };
}
