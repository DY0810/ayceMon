import { describe, expect, it } from "vitest";

import { aggregateContributors } from "./aggregate-contributors";

// These tests anchor the pure aggregation helper that powers the
// `contributors` field on useSharedSession's return value. The hook itself
// stays silent to vitest (no jsdom / react-testing-library in this repo) —
// all logic is pulled into the helper specifically so it can be tested in
// isolation here.

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const USER_C = "33333333-3333-3333-3333-333333333333";

describe("aggregateContributors", () => {
  it("happy path: 2 users, 3 items — per-user totals are correct", () => {
    const result = aggregateContributors({
      items: [
        { id: "sushi", ala_carte_value: "10", grams_per_unit: "100" },
        { id: "steak", ala_carte_value: "25", grams_per_unit: "200" },
        { id: "ice-cream", ala_carte_value: "5", grams_per_unit: "50" },
      ],
      entries: [
        {
          user_id: USER_A,
          item_id: "sushi",
          units: "2",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
        {
          user_id: USER_A,
          item_id: "steak",
          units: "1",
          grams: "250",
          logged_at: "2026-04-18T12:05:00Z",
        },
        {
          user_id: USER_B,
          item_id: "ice-cream",
          units: "3",
          grams: null,
          logged_at: "2026-04-18T12:10:00Z",
        },
      ],
      collaborators: [
        { user_id: USER_A, role: "owner" },
        { user_id: USER_B, role: "collaborator" },
      ],
    });

    expect(result).toHaveLength(2);
    const a = result.find((c) => c.userId === USER_A);
    const b = result.find((c) => c.userId === USER_B);
    if (!a || !b) throw new Error("expected both users present");

    // owner: 2 sushi @ $10 + 1 steak @ $25 = $45.
    // grams: sushi uses units×gpu (2×100=200); steak uses direct grams (250) → 450.
    expect(a.valueEaten).toBe(45);
    expect(a.grams).toBe(450);
    expect(a.unitCount).toBe(3);
    expect(a.role).toBe("owner");
    expect(a.lastLoggedAt).toBe("2026-04-18T12:05:00Z");

    expect(b.valueEaten).toBe(15);
    expect(b.grams).toBe(150);
    expect(b.unitCount).toBe(3);
    expect(b.role).toBe("collaborator");
    expect(b.lastLoggedAt).toBe("2026-04-18T12:10:00Z");
  });

  it("roster of 3 with entries from only 2 — third collaborator shows as zero row", () => {
    const result = aggregateContributors({
      items: [{ id: "sushi", ala_carte_value: "10", grams_per_unit: "100" }],
      entries: [
        {
          user_id: USER_A,
          item_id: "sushi",
          units: "1",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
        {
          user_id: USER_B,
          item_id: "sushi",
          units: "2",
          grams: null,
          logged_at: "2026-04-18T12:01:00Z",
        },
      ],
      collaborators: [
        { user_id: USER_A, role: "owner" },
        { user_id: USER_B, role: "collaborator" },
        { user_id: USER_C, role: "collaborator" },
      ],
    });

    expect(result).toHaveLength(3);
    const c = result.find((x) => x.userId === USER_C);
    if (!c) throw new Error("user C missing");
    expect(c.valueEaten).toBe(0);
    expect(c.grams).toBe(0);
    expect(c.unitCount).toBe(0);
    expect(c.lastLoggedAt).toBeNull();
    expect(c.role).toBe("collaborator");
  });

  it("owner only, no entries — returns single zero row", () => {
    const result = aggregateContributors({
      items: [],
      entries: [],
      collaborators: [{ user_id: USER_A, role: "owner" }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userId: USER_A,
      valueEaten: 0,
      grams: 0,
      unitCount: 0,
      lastLoggedAt: null,
      role: "owner",
    });
  });

  it("uses displayNameById map when provided; falls back to shortUserId otherwise", () => {
    const result = aggregateContributors(
      {
        items: [],
        entries: [],
        collaborators: [
          { user_id: USER_A, role: "owner" },
          { user_id: USER_B, role: "collaborator" },
        ],
      },
      new Map([[USER_A, "alice"]]),
    );

    const a = result.find((c) => c.userId === USER_A);
    const b = result.find((c) => c.userId === USER_B);
    if (!a || !b) throw new Error("missing row");
    expect(a.displayName).toBe("alice");
    expect(b.displayName).toBe("22222222");
  });

  it("direct grams on an entry wins over units × gramsPerUnit", () => {
    const result = aggregateContributors({
      items: [{ id: "sushi", ala_carte_value: "10", grams_per_unit: "100" }],
      entries: [
        {
          user_id: USER_A,
          item_id: "sushi",
          units: "1",
          grams: "300",
          logged_at: "2026-04-18T12:00:00Z",
        },
      ],
      collaborators: [{ user_id: USER_A, role: "owner" }],
    });

    expect(result[0].grams).toBe(300);
  });

  it("items with null gramsPerUnit contribute zero grams", () => {
    const result = aggregateContributors({
      items: [{ id: "drink", ala_carte_value: "4", grams_per_unit: null }],
      entries: [
        {
          user_id: USER_A,
          item_id: "drink",
          units: "2",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
      ],
      collaborators: [{ user_id: USER_A, role: "owner" }],
    });

    expect(result[0].valueEaten).toBe(8);
    expect(result[0].grams).toBe(0);
    expect(result[0].unitCount).toBe(2);
  });

  it("sorts rows by userId for deterministic output", () => {
    const result = aggregateContributors({
      items: [],
      entries: [],
      collaborators: [
        { user_id: USER_C, role: "collaborator" },
        { user_id: USER_A, role: "owner" },
        { user_id: USER_B, role: "collaborator" },
      ],
    });
    expect(result.map((r) => r.userId)).toEqual([USER_A, USER_B, USER_C]);
  });

  it("entries from an unknown user_id still aggregate (defensive)", () => {
    // Not reachable via RLS in practice, but the helper must not drop rows
    // silently — falling back to role "collaborator" keeps totals honest.
    const result = aggregateContributors({
      items: [{ id: "sushi", ala_carte_value: "10", grams_per_unit: "100" }],
      entries: [
        {
          user_id: USER_A,
          item_id: "sushi",
          units: "1",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
      ],
      collaborators: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(USER_A);
    expect(result[0].role).toBe("collaborator");
  });
});
