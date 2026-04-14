import { describe, expect, it } from "vitest";

import { selectLogEatenTarget } from "./log-eaten";

// Phase 3 dual-path invariant (Appendix B #16): every mutation site in the
// UI must branch on `sharedSessionId`. This tiny selector is the pure,
// testable core of that branch — the page-level callback wraps it and
// calls either `store.logEaten` (solo) or `logSharedEaten` (shared). A
// unit test anchors the rule so a future edit that silently drops the
// branch gets caught at CI.

describe("selectLogEatenTarget", () => {
  it("selects the solo Zustand path when sharedSessionId is null", () => {
    expect(selectLogEatenTarget(null)).toBe("solo");
  });

  it("selects the solo path when sharedSessionId is undefined (defensive)", () => {
    expect(selectLogEatenTarget(undefined)).toBe("solo");
  });

  it("selects the shared server-action path when sharedSessionId is a non-empty string", () => {
    expect(selectLogEatenTarget("9f91c1c5-aaaa-4bbb-8ccc-deadbeefcafe")).toBe(
      "shared",
    );
  });

  it("treats an empty-string sharedSessionId as solo (no id == no shared session)", () => {
    // Empty strings shouldn't occur in practice — the store writes either a
    // uuid or null — but the branch must degrade safely if a bug ever leaves
    // an empty string on the wire.
    expect(selectLogEatenTarget("")).toBe("solo");
  });
});
