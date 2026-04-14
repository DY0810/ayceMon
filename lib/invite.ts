import "server-only";

import { randomBytes } from "node:crypto";

// Phase 7 (collab-and-quantitative-appetite): invite token mint + per-IP
// rate limit for /join redemption.
//
// Tokens are 128-bit (16 bytes) from the Node CSPRNG, base64url-encoded
// (22 chars, no padding). They're opaque DB lookup keys — NOT JWTs — so
// no session data is embedded in the wire format. See Appendix B #15.
//
// The rate limit mirrors the places/rate-limit.ts pattern: an in-memory
// Map keyed by client IP, sliding-window counter, stale-entry prune.
// DEV-ONLY — per-instance memory does not survive cold starts and is
// trivially evadable by rotating IPs. Before public launch, move to
// Upstash/Vercel KV (see PLAN.md Phase 7 polish notes).

// ---------------------------------------------------------------------------
// Token generator
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 16; // 128 bits of entropy

export function generateInviteToken(): string {
  // Node's `base64url` encoding drops the `=` padding and uses `-_`
  // instead of `+/`, which matches the URL-safe alphabet used in the
  // /join?token=… query string.
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

// ---------------------------------------------------------------------------
// Per-IP rate limit for /join redemption
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60 * 60_000; // 1 hour
const MAX_JOINS_PER_WINDOW = 10;

const buckets = new Map<string, Bucket>();
let lastPruneTime = Date.now();
const PRUNE_INTERVAL_MS = 5 * 60_000;

function pruneStale(now: number) {
  if (now - lastPruneTime < PRUNE_INTERVAL_MS) return;
  lastPruneTime = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= WINDOW_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimitInviteJoin(
  ip: string,
  userId?: string | null,
): RateLimitResult {
  // Composite bucket key — `ip:userId` when we have both. Keys IP-only
  // if the caller lacks an authenticated identity (shouldn't happen at
  // the /join call site — requireUser runs first — but the helper is
  // flexible enough to support auth-optional callers).
  //
  // Security review T5(c): an authenticated attacker rotating IPs can
  // otherwise bypass the per-IP cap. With `${ip}:${userId}` included,
  // the per-account throttle applies independently of network.
  const key = userId ? `${ip}:${userId}` : ip;
  const now = Date.now();
  pruneStale(now);
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: MAX_JOINS_PER_WINDOW - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= MAX_JOINS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000),
    );
    return { ok: false, remaining: 0, retryAfterSeconds };
  }

  bucket.count += 1;
  return {
    ok: true,
    remaining: MAX_JOINS_PER_WINDOW - bucket.count,
    retryAfterSeconds: 0,
  };
}

// Test-only: clear the in-memory buckets between test cases so IP state
// from one test doesn't leak into the next. Exported with a __ prefix
// and an explicit "ForTests" suffix so production callers cannot mistake
// it for a supported API.
export function __resetInviteRateLimitForTests(): void {
  buckets.clear();
  lastPruneTime = Date.now();
}

// ---------------------------------------------------------------------------
// Client IP extraction (from a Headers object produced by next/headers)
//
// Mirrors places/rate-limit.ts#getClientIp, but takes a Headers instance
// instead of a Request so server actions can use it directly:
//
//   const h = await headers();
//   const ip = getClientIpFromHeaders(h);
//
// Prefer x-real-ip (set by trusted reverse proxies) over x-forwarded-for
// (which can be spoofed by untrusted clients). When reading XFF, use the
// LAST entry — the rightmost IP is the one appended by the trusted proxy
// closest to the server; earlier entries are client-supplied.
// ---------------------------------------------------------------------------
export function getClientIpFromHeaders(headers: Headers): string {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return "unknown";
}
