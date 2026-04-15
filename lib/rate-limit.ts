import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Production rate limiter. Backed by Upstash Redis (sliding window) when
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set in the
// environment; falls back to an in-memory per-instance Map otherwise so
// `npm run dev` and vitest work without external infra.
//
// The fallback is DEV-ONLY: a serverless deploy without Upstash credentials
// gets a separate bucket per cold-start instance, trivially bypassable. The
// Upstash-backed path shares buckets across all invocations and is the
// correct limiter for public traffic.

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitConfig {
  key: string; // the per-caller identifier (ip, userId, `${ip}:${userId}`)
  prefix: string; // namespace so unrelated limiters never share a bucket
  limit: number; // max events per window
  windowMs: number; // window length in ms
}

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasUpstash ? Redis.fromEnv() : null;

// Cache one Ratelimit instance per (prefix, limit, windowMs) tuple so we
// reuse the same sliding-window script across requests. Ratelimit
// construction is cheap but not free, and reusing preserves Upstash's
// internal script caching.
const limiterCache = new Map<string, Ratelimit>();

function getUpstashLimiter(cfg: RateLimitConfig): Ratelimit | null {
  if (!redis) return null;
  const cacheKey = `${cfg.prefix}:${cfg.limit}:${cfg.windowMs}`;
  const cached = limiterCache.get(cacheKey);
  if (cached) return cached;
  const seconds = Math.max(1, Math.ceil(cfg.windowMs / 1000));
  const fresh = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.limit, `${seconds} s`),
    prefix: cfg.prefix,
    analytics: false,
  });
  limiterCache.set(cacheKey, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// In-memory fallback (dev / test only)
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
let lastPruneTime = Date.now();
const PRUNE_INTERVAL_MS = 5 * 60_000;

function pruneStale(now: number) {
  if (now - lastPruneTime < PRUNE_INTERVAL_MS) return;
  lastPruneTime = now;
  // Drop buckets whose window is definitively closed. We don't know the
  // window size each entry was created under, but anything older than 24h
  // is safe to evict.
  const MAX_WINDOW = 24 * 60 * 60_000;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= MAX_WINDOW) buckets.delete(key);
  }
}

function memoryRateLimit(cfg: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  pruneStale(now);
  const fullKey = `${cfg.prefix}:${cfg.key}`;
  const bucket = buckets.get(fullKey);

  if (!bucket || now - bucket.windowStart >= cfg.windowMs) {
    buckets.set(fullKey, { count: 1, windowStart: now });
    return { ok: true, remaining: cfg.limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= cfg.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((cfg.windowMs - (now - bucket.windowStart)) / 1000),
    );
    return { ok: false, remaining: 0, retryAfterSeconds };
  }

  bucket.count += 1;
  return {
    ok: true,
    remaining: cfg.limit - bucket.count,
    retryAfterSeconds: 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function rateLimit(
  cfg: RateLimitConfig,
): Promise<RateLimitResult> {
  const upstash = getUpstashLimiter(cfg);
  if (!upstash) return memoryRateLimit(cfg);

  const res = await upstash.limit(cfg.key);
  const retryAfterSeconds = res.success
    ? 0
    : Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
  return {
    ok: res.success,
    remaining: Math.max(0, res.remaining),
    retryAfterSeconds,
  };
}

// Whether Upstash is configured. Exposed so tests / boot logs can sanity-
// check their environment rather than silently running on the in-memory
// fallback.
export function isDistributedRateLimitActive(): boolean {
  return hasUpstash;
}

// Test-only: clear the in-memory buckets between test cases. Only affects
// the fallback; tests never hit Upstash because the env vars aren't set
// under vitest.
export function __resetRateLimitForTests(): void {
  buckets.clear();
  lastPruneTime = Date.now();
  limiterCache.clear();
}
