import { describe, expect, it } from "vitest";

import { diffJoinedUserIds } from "./roster-diff";

const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("diffJoinedUserIds", () => {
  it("seeds without firing on the first mount (prev === null)", () => {
    const result = diffJoinedUserIds(
      null,
      new Set([USER_A, USER_B]),
      USER_A,
    );
    expect(result.joined).toEqual([]);
    expect(result.nextSeen).toEqual(new Set([USER_A, USER_B]));
  });

  it("returns newly-added user_ids on a subsequent diff", () => {
    const result = diffJoinedUserIds(
      new Set([USER_A]),
      new Set([USER_A, USER_B]),
      USER_A,
    );
    expect(result.joined).toEqual([USER_B]);
    expect(result.nextSeen).toEqual(new Set([USER_A, USER_B]));
  });

  it("returns an empty array when the roster is unchanged", () => {
    const result = diffJoinedUserIds(
      new Set([USER_A, USER_B]),
      new Set([USER_A, USER_B]),
      USER_A,
    );
    expect(result.joined).toEqual([]);
  });

  it("suppresses self-join", () => {
    // selfUserId = USER_A; A was absent from prev, so a naive diff would
    // flag it as a join. The helper must not.
    const result = diffJoinedUserIds(
      new Set([USER_B]),
      new Set([USER_A, USER_B]),
      USER_A,
    );
    expect(result.joined).toEqual([]);
    expect(result.nextSeen).toEqual(new Set([USER_A, USER_B]));
  });

  it("returns every new user_id when multiple join in the same tick", () => {
    const result = diffJoinedUserIds(
      new Set([USER_A]),
      new Set([USER_A, USER_B, USER_C]),
      USER_A,
    );
    expect(result.joined).toHaveLength(2);
    expect(new Set(result.joined)).toEqual(new Set([USER_B, USER_C]));
  });

  it("with a null selfUserId (guest / pre-auth) fires for every new id", () => {
    const result = diffJoinedUserIds(
      new Set([USER_A]),
      new Set([USER_A, USER_B]),
      null,
    );
    expect(result.joined).toEqual([USER_B]);
  });

  it("handles an empty current roster (session drained)", () => {
    const result = diffJoinedUserIds(
      new Set([USER_A, USER_B]),
      new Set(),
      USER_A,
    );
    expect(result.joined).toEqual([]);
    expect(result.nextSeen).toEqual(new Set());
  });

  it("nextSeen is a fresh Set the caller can mutate safely", () => {
    const current = new Set([USER_A]);
    const result = diffJoinedUserIds(null, current, null);
    result.nextSeen.add(USER_B);
    expect(current.has(USER_B)).toBe(false);
  });
});
