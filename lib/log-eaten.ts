// Dual-path branch selector (Phase 3 · Appendix B #16). Pure and tiny on
// purpose: the tracker page-level callback calls this, then dispatches to
// either the Zustand `logEaten` method (solo) or the `logSharedEaten`
// server action (shared). Keeping the decision in its own function makes
// it unit-testable without mounting the page or importing server-only
// modules into the test runner.
export type LogEatenTarget = "solo" | "shared";

export function selectLogEatenTarget(
  sharedSessionId: string | null | undefined,
): LogEatenTarget {
  return typeof sharedSessionId === "string" && sharedSessionId.length > 0
    ? "shared"
    : "solo";
}
