import { describe, expect, it } from "vitest";

import { aggregateActivity } from "./aggregate-activity";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

describe("aggregateActivity", () => {
  it("joins entries with item names and sorts newest-first", () => {
    const result = aggregateActivity({
      items: [
        { id: "sushi", name: "Salmon nigiri" },
        { id: "steak", name: "Ribeye steak" },
      ],
      entries: [
        {
          id: "e1",
          user_id: USER_A,
          item_id: "sushi",
          units: "2",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
        {
          id: "e2",
          user_id: USER_B,
          item_id: "steak",
          units: "1",
          grams: "250",
          logged_at: "2026-04-18T12:05:00Z",
        },
      ],
    });

    expect(result).toHaveLength(2);
    // Newest first
    expect(result[0].entryId).toBe("e2");
    expect(result[0].itemName).toBe("Ribeye steak");
    expect(result[0].units).toBe(1);
    expect(result[0].grams).toBe(250);
    expect(result[1].entryId).toBe("e1");
    expect(result[1].itemName).toBe("Salmon nigiri");
    expect(result[1].grams).toBeNull();
  });

  it("uses displayNameById map when provided; falls back to shortUserId", () => {
    const result = aggregateActivity(
      {
        items: [{ id: "sushi", name: "Nigiri" }],
        entries: [
          {
            id: "e1",
            user_id: USER_A,
            item_id: "sushi",
            units: "1",
            grams: null,
            logged_at: "2026-04-18T12:00:00Z",
          },
          {
            id: "e2",
            user_id: USER_B,
            item_id: "sushi",
            units: "1",
            grams: null,
            logged_at: "2026-04-18T12:01:00Z",
          },
        ],
      },
      new Map([[USER_A, "alice"]]),
    );

    const a = result.find((e) => e.userId === USER_A);
    const b = result.find((e) => e.userId === USER_B);
    if (!a || !b) throw new Error("expected both users");
    expect(a.displayName).toBe("alice");
    expect(b.displayName).toBe("22222222");
  });

  it("ties on loggedAt are broken by entryId for stable order", () => {
    const result = aggregateActivity({
      items: [{ id: "sushi", name: "Nigiri" }],
      entries: [
        {
          id: "a-entry",
          user_id: USER_A,
          item_id: "sushi",
          units: "1",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
        {
          id: "z-entry",
          user_id: USER_B,
          item_id: "sushi",
          units: "1",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
      ],
    });

    expect(result.map((e) => e.entryId)).toEqual(["z-entry", "a-entry"]);
  });

  it("drops entries with non-finite units", () => {
    const result = aggregateActivity({
      items: [{ id: "sushi", name: "Nigiri" }],
      entries: [
        {
          id: "bad",
          user_id: USER_A,
          item_id: "sushi",
          units: "not-a-number",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
        {
          id: "good",
          user_id: USER_A,
          item_id: "sushi",
          units: "1",
          grams: null,
          logged_at: "2026-04-18T12:01:00Z",
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].entryId).toBe("good");
  });

  it("renders 'Unknown item' when item_id is not in the items list", () => {
    // Not reachable in practice (FK constraint), but the helper must not
    // crash — it should render a sentinel name.
    const result = aggregateActivity({
      items: [],
      entries: [
        {
          id: "e1",
          user_id: USER_A,
          item_id: "ghost",
          units: "1",
          grams: null,
          logged_at: "2026-04-18T12:00:00Z",
        },
      ],
    });
    expect(result[0].itemName).toBe("Unknown item");
  });

  it("preserves grams=0 as 0, not null", () => {
    const result = aggregateActivity({
      items: [{ id: "sushi", name: "Nigiri" }],
      entries: [
        {
          id: "e1",
          user_id: USER_A,
          item_id: "sushi",
          units: "1",
          grams: "0",
          logged_at: "2026-04-18T12:00:00Z",
        },
      ],
    });
    expect(result[0].grams).toBe(0);
  });

  it("empty entries → empty result", () => {
    const result = aggregateActivity({
      items: [{ id: "sushi", name: "Nigiri" }],
      entries: [],
    });
    expect(result).toEqual([]);
  });
});
