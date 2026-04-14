import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only so importing stats.ts doesn't throw in a test environment.
vi.mock("server-only", () => ({}));

import { getUserStats, getRestaurantStats } from "./stats";

// Minimal mock builder — returns a chainable Supabase-query-shaped object.
function mockSupabase(response: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(response),
    order: vi.fn().mockResolvedValue(response),
    eq: vi.fn().mockReturnThis(),
  };
  return { from: vi.fn().mockReturnValue(chain), _chain: chain };
}

describe("getUserStats", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns null when no rows exist", async () => {
    const sb = mockSupabase({ data: null, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const result = await getUserStats(sb as any);
    expect(result).toBeNull();
    expect(sb.from).toHaveBeenCalledWith("user_stats");
  });

  it("maps a view row to UserStats shape", async () => {
    const sb = mockSupabase({
      data: {
        total_sessions: 5,
        total_wins: 3,
        total_losses: 2,
        total_margin: "12.50",
        best_margin: "8.00",
        worst_margin: "-3.50",
      },
      error: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const result = await getUserStats(sb as any);
    expect(result).toEqual({
      totalSessions: 5,
      totalWins: 3,
      totalLosses: 2,
      totalMargin: 12.5,
      bestMargin: 8,
      worstMargin: -3.5,
    });
  });

  it("throws when supabase returns an error", async () => {
    const sb = mockSupabase({ data: null, error: new Error("db down") });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    await expect(getUserStats(sb as any)).rejects.toThrow("db down");
  });
});

describe("getRestaurantStats", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns an empty array when no data", async () => {
    const sb = mockSupabase({ data: [], error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const result = await getRestaurantStats(sb as any);
    expect(result).toEqual([]);
  });

  it("maps rows to RestaurantStats shape", async () => {
    const sb = mockSupabase({
      data: [
        {
          restaurant_id: "r1",
          restaurant_name: "Gen Korean BBQ",
          sessions: 3,
          wins: 2,
          losses: 1,
          total_margin: "7.51",
          last_visited_at: "2026-04-09T00:00:00Z",
        },
      ],
      error: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const result = await getRestaurantStats(sb as any);
    expect(result).toEqual([
      {
        restaurantId: "r1",
        restaurantName: "Gen Korean BBQ",
        sessions: 3,
        wins: 2,
        losses: 1,
        totalMargin: 7.51,
        lastVisitedAt: "2026-04-09T00:00:00Z",
      },
    ]);
  });
});
