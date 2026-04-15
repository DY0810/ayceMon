import "server-only";

import {
  rateLimit as baseRateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";

// Per-IP rate limit for the Places API routes. Backed by Upstash when the
// UPSTASH_REDIS_REST_URL/_TOKEN env vars are set in production; falls back
// to per-instance memory for local dev and tests. The limits live here so
// the route handlers read a single source of truth.

const PLACES_WINDOW_MS = 60_000;
const PLACES_MAX_PER_WINDOW = 60;

export type { RateLimitResult };

export async function rateLimit(ip: string): Promise<RateLimitResult> {
  return baseRateLimit({
    key: ip,
    prefix: "places",
    limit: PLACES_MAX_PER_WINDOW,
    windowMs: PLACES_WINDOW_MS,
  });
}

export function getClientIp(req: Request): string {
  // Prefer x-real-ip (set by trusted reverse proxies like nginx-ingress) over
  // x-forwarded-for (which can be spoofed by untrusted clients).
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Use the LAST entry — the rightmost IP is the one appended by the
    // trusted proxy closest to the server. Earlier entries are client-supplied.
    const parts = xff.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return "unknown";
}
