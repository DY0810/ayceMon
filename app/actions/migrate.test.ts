import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Session } from "@/lib/types";

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

// The admin client is unreachable from these tests: every fixture omits
// `resolvedPlace` so migrate.ts skips the restaurants upsert path.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      throw new Error("admin client should not be called");
    },
  }),
}));

vi.mock("@/lib/places/resolve", () => ({
  fetchPlaceDetails: vi.fn(),
  PlacesApiError: class PlacesApiError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

const USER_ID = "11111111-1111-1111-1111-111111111111";

interface CapturedUpsert {
  row: Record<string, unknown>;
  conflict?: string;
  ignoreDuplicates?: boolean;
}

const captured: { upserts: CapturedUpsert[] } = { upserts: [] };

function buildMockSupabase() {
  return {
    from(table: string) {
      if (table !== "session_records") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        upsert(
          row: Record<string, unknown>,
          opts?: { onConflict?: string; ignoreDuplicates?: boolean },
        ) {
          captured.upserts.push({
            row,
            conflict: opts?.onConflict,
            ignoreDuplicates: opts?.ignoreDuplicates,
          });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
}

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({
    user: { id: USER_ID },
    supabase: buildMockSupabase(),
  }),
}));

// Import after mocks are declared.
import { promoteGuestSessions } from "./migrate";

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID(),
    restaurantName: "Test Buffet",
    buffetPrice: 30,
    appetiteBudget: 50,
    library: [
      {
        id: "itm-1",
        name: "Nigiri",
        alaCarteValue: 4,
        fillFactor: 1,
        gramsPerUnit: 25,
      },
    ],
    eaten: [{ itemId: "itm-1", units: 6 }],
    startedAt: Date.parse("2026-04-13T18:00:00.000Z"),
    finishedAt: Date.parse("2026-04-13T19:30:00.000Z"),
    ...overrides,
  };
}

describe("promoteGuestSessions — appetite_budget_grams backfill", () => {
  beforeEach(() => {
    captured.upserts = [];
  });

  it("propagates appetiteBudgetGrams into the session_records insert", async () => {
    const session = buildSession({ appetiteBudgetGrams: 1500 });

    const result = await promoteGuestSessions([session]);

    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.promoted).toEqual([session.id]);
    expect(captured.upserts).toHaveLength(1);
    expect(captured.upserts[0].row.appetite_budget_grams).toBe(1500);
    // Legacy column must still be set for back-compat.
    expect(captured.upserts[0].row.appetite_budget).toBe(50);
  });

  it("writes null when the guest opted out (appetiteBudgetGrams = null)", async () => {
    const session = buildSession({ appetiteBudgetGrams: null });

    const result = await promoteGuestSessions([session]);

    expect(result.promoted).toEqual([session.id]);
    expect(captured.upserts[0].row.appetite_budget_grams).toBeNull();
  });

  it("writes null when the guest session predates grams (undefined)", async () => {
    const session = buildSession();
    expect(session.appetiteBudgetGrams).toBeUndefined();

    const result = await promoteGuestSessions([session]);

    expect(result.promoted).toEqual([session.id]);
    expect(captured.upserts[0].row.appetite_budget_grams).toBeNull();
  });

  it("rejects sessions with an out-of-range grams budget", async () => {
    const tooHigh = buildSession({ appetiteBudgetGrams: 50_000 });
    const tooLow = buildSession({ appetiteBudgetGrams: 10 });

    const result = await promoteGuestSessions([tooHigh, tooLow]);

    expect(result.promoted).toEqual([]);
    expect(result.failed.map((f) => f.error)).toEqual([
      "invalid_input",
      "invalid_input",
    ]);
    expect(captured.upserts).toHaveLength(0);
  });
});
