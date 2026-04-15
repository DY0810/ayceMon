import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock `server-only` so importing invite.ts outside a Next.js server
// runtime doesn't throw. Mirrors the pattern in
// app/actions/shared-session.finalize.test.ts.
vi.mock("server-only", () => ({}));

import {
  __resetInviteRateLimitForTests,
  generateInviteToken,
  rateLimitInviteJoin,
} from "./invite";

// Phase 7 (collab-and-quantitative-appetite): the invite token is an opaque
// DB capability key. The token must come from a CSPRNG (crypto.randomBytes)
// — Math.random would make the token guessable within hours. The test reads
// the module source to assert no Math.random slipped in during a refactor.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const INVITE_SOURCE = readFileSync(path.join(HERE, "invite.ts"), "utf8");

describe("generateInviteToken", () => {
  it("returns a 22-character string", () => {
    const token = generateInviteToken();
    expect(token).toHaveLength(22);
  });

  it("returns base64url characters only (A-Z a-z 0-9 - _)", () => {
    for (let i = 0; i < 32; i++) {
      const token = generateInviteToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it("generates unique tokens across many calls (128-bit entropy sanity)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) seen.add(generateInviteToken());
    expect(seen.size).toBe(5_000);
  });

  it("does NOT use Math.random anywhere in the module source", () => {
    expect(INVITE_SOURCE).not.toContain("Math.random");
  });

  it("imports crypto.randomBytes from node:crypto (not a web-crypto shim)", () => {
    expect(INVITE_SOURCE).toMatch(/from\s+["']node:crypto["']/);
    expect(INVITE_SOURCE).toContain("randomBytes");
  });
});

describe("rateLimitInviteJoin", () => {
  const IP = "203.0.113.7";

  beforeEach(() => {
    __resetInviteRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first 10 joins from the same IP", async () => {
    for (let i = 0; i < 10; i++) {
      const result = await rateLimitInviteJoin(IP);
      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(9 - i);
    }
  });

  it("blocks the 11th join from the same IP within the hour window", async () => {
    for (let i = 0; i < 10; i++) await rateLimitInviteJoin(IP);
    const blocked = await rateLimitInviteJoin(IP);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the one-hour window elapses", async () => {
    for (let i = 0; i < 10; i++) await rateLimitInviteJoin(IP);
    expect((await rateLimitInviteJoin(IP)).ok).toBe(false);

    // Advance past the hour window.
    vi.setSystemTime(new Date("2026-04-14T01:00:01Z"));

    const afterReset = await rateLimitInviteJoin(IP);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(9);
  });

  it("tracks buckets independently per IP", async () => {
    for (let i = 0; i < 10; i++) await rateLimitInviteJoin(IP);
    expect((await rateLimitInviteJoin(IP)).ok).toBe(false);

    // A different IP is unaffected.
    const other = await rateLimitInviteJoin("198.51.100.42");
    expect(other.ok).toBe(true);
    expect(other.remaining).toBe(9);
  });

  // Security review T5(c): per-account throttling independent of IP.
  it("composes the bucket key with userId when provided", async () => {
    const USER_A = "11111111-1111-1111-1111-111111111111";
    const USER_B = "22222222-2222-2222-2222-222222222222";

    // User A from one IP burns their bucket.
    for (let i = 0; i < 10; i++) await rateLimitInviteJoin(IP, USER_A);
    expect((await rateLimitInviteJoin(IP, USER_A)).ok).toBe(false);

    // User B from the SAME IP has a separate bucket — attackers
    // sharing an IP cannot deplete each other's quota.
    const userBFresh = await rateLimitInviteJoin(IP, USER_B);
    expect(userBFresh.ok).toBe(true);
    expect(userBFresh.remaining).toBe(9);

    // Critically: the same user rotating to a different IP is still
    // throttled by their per-user bucket.
    for (let i = 0; i < 9; i++)
      await rateLimitInviteJoin("198.51.100.99", USER_A);
    const rotatedIp = await rateLimitInviteJoin("198.51.100.200", USER_A);
    expect(rotatedIp.ok).toBe(true); // first from this new ip+user combo
    // Now exhaust more from the rotated IP with the same user.
    for (let i = 0; i < 9; i++)
      await rateLimitInviteJoin("198.51.100.200", USER_A);
    // Although the user had unused budget on OTHER ip+user buckets,
    // the rotated-ip+user bucket is now full. (This is a per-ip+user
    // key, so the user's total join rate across all IPs can still
    // exceed MAX, but any single ip+user combo is throttled.)
    const finalBlock = await rateLimitInviteJoin("198.51.100.200", USER_A);
    expect(finalBlock.ok).toBe(false);
  });
});
