import "server-only";

import { randomBytes } from "node:crypto";

import {
  __resetRateLimitForTests,
  rateLimit as baseRateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";

// Phase 7 (collab-and-quantitative-appetite): invite token mint + per-IP
// rate limit for /join redemption.
//
// Tokens are 128-bit (16 bytes) from the Node CSPRNG, base64url-encoded
// (22 chars, no padding). They're opaque DB lookup keys — NOT JWTs — so
// no session data is embedded in the wire format. See Appendix B #15.
//
// The join rate limit is shared through lib/rate-limit.ts so it runs on
// Upstash Redis in production and the in-memory fallback locally.

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
// Per-IP / per-IP+user rate limit for /join redemption
// ---------------------------------------------------------------------------

const INVITE_WINDOW_MS = 60 * 60_000; // 1 hour
const INVITE_MAX_PER_WINDOW = 10;

export type { RateLimitResult };

export async function rateLimitInviteJoin(
  ip: string,
  userId?: string | null,
): Promise<RateLimitResult> {
  // Composite bucket key — `ip:userId` when we have both. Keys IP-only
  // if the caller lacks an authenticated identity (shouldn't happen at
  // the /join call site — requireUser runs first — but the helper is
  // flexible enough to support auth-optional callers).
  //
  // Security review T5(c): an authenticated attacker rotating IPs can
  // otherwise bypass the per-IP cap. With `${ip}:${userId}` included,
  // the per-account throttle applies independently of network.
  const key = userId ? `${ip}:${userId}` : ip;
  return baseRateLimit({
    key,
    prefix: "invite",
    limit: INVITE_MAX_PER_WINDOW,
    windowMs: INVITE_WINDOW_MS,
  });
}

// Test-only: clear the in-memory fallback state between test cases so IP
// state from one test doesn't leak into the next. Re-exports the shared
// reset so existing call sites keep working after the refactor.
export function __resetInviteRateLimitForTests(): void {
  __resetRateLimitForTests();
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
