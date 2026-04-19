"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  computeFullness,
  computeTotals,
  didYouWin,
  margin,
  totalEatenValue,
} from "@/lib/calc";
import { UNATTRIBUTED_USER_ID, formatGrams, shortUserId } from "@/lib/format";
import { useAyceStore } from "@/lib/store";
import type { EatenEntry, Item, ItemId, Session } from "@/lib/types";
import { useSharedSession } from "@/lib/use-shared-session";

// Threshold for the "right on the line" headline (anti-pattern guard
// from PLAN.md Phase 5: don't celebrate or mourn pennies).
const LINE_EPSILON = 0.5;

interface BreakdownRow {
  itemId: ItemId;
  name: string;
  units: number;
  perUnitValue: number;
  lineTotal: number;
  // Phase 3: grams per line. null when the entry never had an explicit
  // grams override AND the item has no `gramsPerUnit` — i.e. the grams
  // source is unknown. The table renders "—" for null, never "0g" (which
  // would misleadingly imply a user-weighed zero-gram portion).
  gramsDisplay: number | null;
}

// Phase 7: per-user slice of the breakdown table. Only populated when
// `session.contributors?.length > 0` (i.e. a shared session was
// projected into the draft shape). Solo sessions render flat.
interface UserGroup {
  userId: string;
  rows: BreakdownRow[];
  subtotal: number;
}

export default function ResultPage() {
  const router = useRouter();
  const soloSession = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);
  const endSession = useAyceStore((state) => state.endSession);
  const resumeMeal = useAyceStore((state) => state.resumeMeal);
  const sharedSessionId = useAyceStore((state) => state.sharedSessionId);
  const setSharedSessionId = useAyceStore((state) => state.setSharedSessionId);
  const setSharedSessionFinishedAt = useAyceStore(
    (state) => state.setSharedSessionFinishedAt,
  );

  // Phase 6 shared-session view. When sharedSessionId is null the hook
  // short-circuits and no poll fires — safe to call unconditionally.
  const shared = useSharedSession(sharedSessionId);
  const sharedSession = shared.session;
  // Resolved "active session" — shared takes priority when present, else
  // the solo Zustand session. Rendered below after the redirect guards.
  const session: Session | null = sharedSessionId
    ? sharedSession
    : soloSession;

  // Redirect guard (Phase 4 truth table):
  //   1. No active session at all → /setup
  //   2. Active session with finishedAt === null/undefined → /tracker
  //   3. Active session with finishedAt set → render this page
  //
  // Shared sessions wait for the first poll to resolve before deciding —
  // redirecting on an unresolved shared session would bounce the user off
  // /result in the brief window before the route returns its first body.
  // Keeping the redirect calls inside a single useEffect avoids the
  // "call router.replace during render" anti-pattern while still giving
  // each branch of the truth table its own inline early-return below.
  useEffect(() => {
    if (!hasHydrated) return;
    if (sharedSessionId) {
      if (shared.loading && sharedSession === null) return;
      if (sharedSession === null) {
        // Initial load completed with no session. The hook already
        // retried once on 404 (see lib/use-shared-session.ts), so we're
        // past the transient-auth race window — treat this as a stale
        // sharedSessionId and clear it. Without the clear, /setup's
        // arrival gate would bounce us right back to /tracker, which
        // would bounce right back here → infinite loop.
        if (shared.error === "not_found") {
          setSharedSessionId(null);
        }
        router.replace("/setup");
        return;
      }
      if (sharedSession.finishedAt == null) {
        router.replace("/tracker");
      }
      return;
    }
    if (soloSession === null) {
      router.replace("/setup");
      return;
    }
    if (soloSession.finishedAt == null) {
      router.replace("/tracker");
    }
  }, [
    hasHydrated,
    sharedSessionId,
    shared.loading,
    shared.error,
    sharedSession,
    soloSession,
    setSharedSessionId,
    router,
  ]);

  // Mirror the shared session's finishedAt into the store so nav.tsx can
  // decide the /result link's visibility without spinning up a second
  // poller. When no shared session is active we never reach the render
  // path that depends on this mirror, but we still null it defensively so
  // a prior shared-session finish doesn't leak into a later solo flow.
  useEffect(() => {
    if (!sharedSessionId) return;
    // Don't clobber a previously-correct mirror with `null` while the first
    // poll after remount is still in flight — otherwise the /result nav
    // link disappears for the duration of the request.
    if (shared.loading && sharedSession === null) return;
    setSharedSessionFinishedAt(sharedSession?.finishedAt ?? null);
  }, [
    sharedSessionId,
    shared.loading,
    sharedSession,
    setSharedSessionFinishedAt,
  ]);

  const summary = useMemo(() => {
    if (!session) {
      return {
        totalValue: 0,
        marginValue: 0,
        wins: false,
        rows: [] as BreakdownRow[],
        groups: [] as UserGroup[],
        gramsConsumed: 0,
        budgetGrams: null as number | null,
      };
    }
    const itemsById = new Map<ItemId, Item>();
    for (const item of session.library) itemsById.set(item.id, item);

    // Dangling-item guard: if an eaten entry references an itemId that
    // is no longer in the library, skip it instead of crashing.
    // Consistent with lib/calc.ts which also skips unknowns.
    const rows: BreakdownRow[] = [];
    for (const entry of session.eaten) {
      const item = itemsById.get(entry.itemId);
      if (!item) continue;
      rows.push({
        itemId: entry.itemId,
        name: item.name,
        units: entry.units,
        perUnitValue: item.alaCarteValue,
        lineTotal: item.alaCarteValue * entry.units,
        gramsDisplay: resolveGramsDisplay(entry, item),
      });
    }

    // Phase 7: per-user grouping is gated on `contributors` being
    // non-empty. All finish flows (guest, signed-in solo, shared) now
    // route to /result, so this branch lights up for shared sessions
    // whose `contributors` jsonb was populated by finalizeSharedSession.
    const groups: UserGroup[] =
      session.contributors && session.contributors.length > 0
        ? buildUserGroups(session.library, session.eaten, itemsById)
        : [];

    const { grams: gramsConsumed } = computeFullness(
      session.library,
      session.eaten,
      session.appetiteBudgetGrams,
    );

    return {
      totalValue: totalEatenValue(session),
      marginValue: margin(session),
      wins: didYouWin(session),
      rows,
      groups,
      gramsConsumed,
      budgetGrams: session.appetiteBudgetGrams ?? null,
    };
  }, [session]);

  // Render gates — the effect above handles all router.replace calls; the
  // gates below keep stale/in-progress data off the screen until each
  // branch of the truth table resolves. The final `!session.finishedAt`
  // gate matches the effect's redirect condition so we don't flash an
  // unfinished breakdown in the one render between state change and
  // navigation completing.
  if (!hasHydrated) return null;
  if (sharedSessionId && shared.loading && sharedSession === null) return null;
  if (session === null) return null;
  if (!session.finishedAt) return null;

  const {
    totalValue,
    marginValue,
    wins,
    rows,
    groups,
    gramsConsumed,
    budgetGrams,
  } = summary;
  const buffetPrice = session.buffetPrice;
  const fullnessLabel =
    budgetGrams != null && budgetGrams > 0
      ? `${formatGrams(gramsConsumed)} of ${formatGrams(budgetGrams)}`
      : formatGrams(gramsConsumed);

  const onTheLine = Math.abs(marginValue) <= LINE_EPSILON;
  const headline = onTheLine
    ? "Right on the line."
    : wins
    ? `You won! +$${marginValue.toFixed(2)}`
    : `Almost — you were $${Math.abs(marginValue).toFixed(2)} short.`;

  const marginIsPositive = marginValue >= 0;
  const formattedMargin = `${marginIsPositive ? "+" : "-"}$${Math.abs(
    marginValue
  ).toFixed(2)}`;

  function handleEditLog() {
    resumeMeal();
    router.push("/tracker");
  }

  function handleEndSession() {
    endSession();
    router.push("/setup");
  }

  const fillPercent =
    buffetPrice > 0
      ? Math.min(100, (totalValue / buffetPrice) * 100)
      : 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
      <section aria-label="Result headline" className="mb-10 lg:mb-14">
        <h1 className="font-[var(--font-display)] text-4xl font-medium leading-none tracking-[-0.03em] text-foreground md:text-6xl lg:text-7xl">
          {headline}
        </h1>
        {session.restaurantName ? (
          <p className="mt-4 text-sm tracking-[0.01em] text-muted-foreground lg:text-base">
            {session.restaurantName}
          </p>
        ) : null}
      </section>

      {rows.length > 0 ? (
        <div
          aria-label="Eaten vs buffet price"
          className="mb-8 hidden lg:block"
        >
          <div className="relative h-12 w-full overflow-hidden rounded-full bg-secondary lg:h-16">
            <div
              className="h-full bg-foreground transition-all duration-300"
              style={{ width: `${fillPercent}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm tracking-[0.01em] tabular-nums text-muted-foreground">
            <span>${totalValue.toFixed(2)} eaten</span>
            <span>of ${buffetPrice.toFixed(2)} buffet</span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10">
        <Card className="order-2 mb-0 hidden lg:order-1 lg:flex">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex w-full flex-col text-sm tabular-nums lg:text-base">
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-border lg:py-4 lg:first:border-t-0">
                <dt className="tracking-[0.01em] text-muted-foreground">Total eaten</dt>
                <dd className="font-medium text-foreground">
                  ${totalValue.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-border lg:py-4">
                <dt className="tracking-[0.01em] text-muted-foreground">Buffet price</dt>
                <dd className="font-medium text-foreground">
                  ${buffetPrice.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-border lg:py-4">
                <dt className="tracking-[0.01em] text-muted-foreground">Margin</dt>
                <dd
                  className={`font-semibold ${
                    !onTheLine && !marginIsPositive
                      ? "text-destructive"
                      : "text-foreground"
                  }`}
                >
                  {formattedMargin}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-border lg:py-4">
                <dt className="tracking-[0.01em] text-muted-foreground">
                  Fullness
                </dt>
                <dd className="font-medium text-foreground">
                  {fullnessLabel}
                </dd>
              </div>
            </dl>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button
              type="button"
              onClick={handleEndSession}
              className="w-full"
            >
              End session
            </Button>
            <Button
              type="button"
              onClick={handleEditLog}
              variant="outline"
              className="w-full"
            >
              Edit log
            </Button>
          </CardFooter>
        </Card>

        <Card className="order-1 lg:order-2">
          <CardHeader>
            <CardTitle>Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm tracking-[0.01em] text-muted-foreground">
                You didn&apos;t log anything this meal.
              </p>
            ) : groups.length > 0 ? (
              <div className="flex flex-col gap-6">
                {groups.map((g) => (
                  <section
                    key={g.userId}
                    aria-label={`Logged by ${shortUserId(g.userId)}`}
                  >
                    <header className="flex items-baseline justify-between gap-2 pb-2">
                      <h3 className="font-[var(--font-display)] text-sm font-medium tracking-[0.01em] text-foreground lg:text-base">
                        {shortUserId(g.userId)}
                      </h3>
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        ${g.subtotal.toFixed(2)}
                      </span>
                    </header>
                    <BreakdownTable rows={g.rows} />
                  </section>
                ))}
              </div>
            ) : (
              <BreakdownTable rows={rows} />
            )}
          </CardContent>
          <CardFooter className="lg:hidden">
            <dl className="flex w-full flex-col gap-2 text-sm tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <dt className="tracking-[0.01em] text-muted-foreground">Total eaten</dt>
                <dd className="font-medium text-foreground">
                  ${totalValue.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="tracking-[0.01em] text-muted-foreground">Buffet price</dt>
                <dd className="font-medium text-foreground">
                  ${buffetPrice.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="tracking-[0.01em] text-muted-foreground">Margin</dt>
                <dd
                  className={`font-semibold ${
                    !onTheLine && !marginIsPositive
                      ? "text-destructive"
                      : "text-foreground"
                  }`}
                >
                  {formattedMargin}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="tracking-[0.01em] text-muted-foreground">
                  Fullness
                </dt>
                <dd className="font-medium text-foreground">
                  {fullnessLabel}
                </dd>
              </div>
            </dl>
          </CardFooter>
        </Card>

        <div className="order-3 flex flex-col gap-3 lg:hidden">
          <Button
            type="button"
            onClick={handleEditLog}
            variant="outline"
            className="w-full"
          >
            Edit log
          </Button>
          <Button
            type="button"
            onClick={handleEndSession}
            className="w-full"
          >
            End session
          </Button>
        </div>
      </div>
    </main>
  );
}

// Mirrors the formatter used in app/tracker/page.tsx so fractional
// units render consistently (e.g. 0.5, 1, 1.5) across both screens.
function formatUnits(units: number): string {
  return Number.isInteger(units) ? units.toString() : units.toFixed(1);
}

// Phase 3: resolve a per-row grams value for the Breakdown table. Order:
//   1. entry.grams (explicit — 0 is a valid user-weighed value).
//   2. entry.units × item.gramsPerUnit (derived, when both are finite).
//   3. null → caller renders "—". Never render "0g" for an unknown source.
function resolveGramsDisplay(entry: EatenEntry, item: Item): number | null {
  if (typeof entry.grams === "number" && Number.isFinite(entry.grams)) {
    return entry.grams;
  }
  if (
    typeof item.gramsPerUnit === "number" &&
    Number.isFinite(item.gramsPerUnit) &&
    typeof entry.units === "number" &&
    Number.isFinite(entry.units)
  ) {
    return entry.units * item.gramsPerUnit;
  }
  return null;
}

// Phase 7: flat breakdown table, reused by both the solo-flat render
// and the shared-grouped render (one table per user).
function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  return (
    <table className="w-full table-fixed text-sm tabular-nums lg:text-base">
      <thead>
        <tr className="text-left font-[var(--font-display)] text-xs font-medium text-muted-foreground lg:text-sm">
          <th scope="col" className="w-auto py-2 pr-2 font-medium">
            Item
          </th>
          <th scope="col" className="w-12 py-2 px-2 text-right font-medium">
            Units
          </th>
          <th scope="col" className="w-16 py-2 px-2 text-right font-medium">
            Grams
          </th>
          <th scope="col" className="w-16 py-2 px-2 text-right font-medium">
            Per unit
          </th>
          <th scope="col" className="w-20 py-2 pl-2 text-right font-medium">
            Line total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={`${row.itemId}-${i}`}
            className="border-t border-border"
          >
            <td className="py-2.5 pr-2 text-foreground break-words lg:py-3">
              {row.name}
            </td>
            <td className="py-2.5 px-2 text-right text-foreground lg:py-3">
              {formatUnits(row.units)}
            </td>
            <td className="py-2.5 px-2 text-right text-muted-foreground lg:py-3">
              {row.gramsDisplay === null
                ? "—"
                : formatGrams(row.gramsDisplay)}
            </td>
            <td className="py-2.5 px-2 text-right text-muted-foreground lg:py-3">
              ${row.perUnitValue.toFixed(2)}
            </td>
            <td className="py-2.5 pl-2 text-right font-medium text-foreground lg:py-3">
              ${row.lineTotal.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Phase 7: group eaten entries by `entry.userId` and build per-user
// BreakdownRow slices. Called only when `session.contributors` is
// non-empty; solo sessions skip this entirely (and `eaten` has no
// userId anyway). `computeTotals` on each slice reuses the single
// source of truth (invariant #1).
function buildUserGroups(
  library: Item[],
  eaten: EatenEntry[],
  itemsById: Map<ItemId, Item>,
): UserGroup[] {
  const entriesByUser = new Map<string, EatenEntry[]>();
  for (const entry of eaten) {
    const key = entry.userId ?? UNATTRIBUTED_USER_ID;
    const list = entriesByUser.get(key) ?? [];
    list.push(entry);
    entriesByUser.set(key, list);
  }
  const groups: UserGroup[] = [];
  for (const [userId, entries] of entriesByUser) {
    const groupRows: BreakdownRow[] = [];
    for (const entry of entries) {
      const item = itemsById.get(entry.itemId);
      if (!item) continue;
      groupRows.push({
        itemId: entry.itemId,
        name: item.name,
        units: entry.units,
        perUnitValue: item.alaCarteValue,
        lineTotal: item.alaCarteValue * entry.units,
        gramsDisplay: resolveGramsDisplay(entry, item),
      });
    }
    const { total } = computeTotals(library, entries, 0);
    groups.push({ userId, rows: groupRows, subtotal: total });
  }
  // Stable order: unattributed last, everyone else by userId.
  groups.sort((a, b) => {
    if (a.userId === UNATTRIBUTED_USER_ID) return 1;
    if (b.userId === UNATTRIBUTED_USER_ID) return -1;
    return a.userId.localeCompare(b.userId);
  });
  return groups;
}

