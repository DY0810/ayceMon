import "server-only";

// DEV-ONLY rate limit. Per-instance in-memory Map leaks on serverless cold
// starts and is trivially evadable by rotating IPs. Before public launch,
// move to Upstash/Vercel KV (see Phase 7 polish notes in the plan).

interface Bucket {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;

const buckets = new Map<string, Bucket>();
let lastPruneTime = Date.now();
const PRUNE_INTERVAL_MS = 5 * 60_000; // prune stale entries every 5 minutes

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

export function rateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  pruneStale(now);
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return { ok: true, remaining: MAX_REQUESTS_PER_WINDOW - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000),
    );
    return { ok: false, remaining: 0, retryAfterSeconds };
  }

  bucket.count += 1;
  return {
    ok: true,
    remaining: MAX_REQUESTS_PER_WINDOW - bucket.count,
    retryAfterSeconds: 0,
  };
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
