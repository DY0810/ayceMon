"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { finishAndSaveSession } from "@/app/actions/sessions";
import {
  finalizeSharedSession,
  listCollaboratorNames,
  logSharedEaten,
  type CollaboratorName,
} from "@/app/actions/shared-session";
import { ShareDrawer } from "@/components/share-drawer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { computeFullness, margin, totalEatenValue } from "@/lib/calc";
import { formatGrams, shortUserId } from "@/lib/format";
import { selectLogEatenTarget } from "@/lib/log-eaten";
import { useAyceStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Item, ItemId } from "@/lib/types";
import { useAnimatedNumber } from "@/lib/use-animated-number";
import { useSharedSession } from "@/lib/use-shared-session";

export default function TrackerPage() {
  const router = useRouter();
  const soloSession = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);
  const soloLogEaten = useAyceStore((state) => state.logEaten);
  const finishMeal = useAyceStore((state) => state.finishMeal);
  const sharedSessionId = useAyceStore((state) => state.sharedSessionId);
  const setSharedSessionId = useAyceStore((state) => state.setSharedSessionId);

  const shared = useSharedSession(sharedSessionId);
  const session = sharedSessionId ? shared.session : soloSession;
  // Destructure `refresh` before using it in useCallback deps. `shared`
  // itself is a new object reference each render (inline construction in
  // useSharedSession), so depending on it would defeat memoization.
  // `refresh` is itself stable — it's produced by useCallback in the hook.
  const refreshShared = shared.refresh;

  const [logError, setLogError] = useState<string | null>(null);

  const logEaten = useCallback(
    (itemId: ItemId, units: number, grams?: number) => {
      // Dual-path dispatch (Appendix B #16). The selector is a pure helper
      // so its own unit test anchors the branch rule — see lib/log-eaten.ts.
      const target = selectLogEatenTarget(sharedSessionId);
      if (target === "solo" || !sharedSessionId) {
        soloLogEaten(itemId, units, grams);
        return;
      }
      // Shared mode: each call writes a new row with the caller's user_id
      // derived from auth.uid() inside the server action (invariant #14).
      // `units` may be negative for −1 buttons — RLS/check allows it only
      // through a delete path, so we block negatives at the UI layer.
      // Grams-only writes (Phase 3 `+g`) arrive as units=0 + grams>0; they
      // are valid — the server action's input validator accepts units=0.
      if (units < 0) return;
      if (units === 0 && !(typeof grams === "number" && grams > 0)) return;
      setLogError(null);
      void logSharedEaten({ sessionId: sharedSessionId, itemId, units, grams })
        .then((result) => {
          if (!result.ok) {
            setLogError("Could not save that bite. Try again.");
            return;
          }
          return refreshShared();
        })
        .catch(() => setLogError("Could not save that bite. Try again."));
    },
    [sharedSessionId, soloLogEaten, refreshShared],
  );

  // Track the current auth state so the finish handler can branch between
  // the guest flow (local-only, route to /result) and the signed-in flow
  // (call finishAndSaveSession, route to /history/[id]). Tri-state: null
  // before resolution, then { id } or false once resolved.
  const [authUser, setAuthUser] = useState<{ id: string } | null | false>(null);
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setAuthUser(data.user ? { id: data.user.id } : false);
      })
      .catch(() => {
        if (!cancelled) setAuthUser(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, ses) => {
      setAuthUser(ses?.user ? { id: ses.user.id } : false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
  const [finishPending, setFinishPending] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // Phase 7 — Share drawer + collaborator name cache. We fetch display
  // names via listCollaboratorNames (backed by a SECURITY DEFINER RPC
  // gated on session membership). The collaborator *list* already comes
  // from the polled `useSharedSession` hook — we only call the RPC to
  // resolve user_id → email-prefix. Refetched whenever the collaborator
  // roster changes so newly-joined members surface their name in the
  // "Eating with" row and in the Share drawer.
  const [shareOpen, setShareOpen] = useState(false);
  const [collaboratorNames, setCollaboratorNames] = useState<CollaboratorName[]>(
    [],
  );
  // `collaboratorIdsKey` is a sorted, comma-joined string of user_ids;
  // it changes iff the set changes, which is exactly when the effect
  // needs to refire. Length is encoded by the key (a shorter/longer
  // string), so we don't list it separately.
  const collaboratorIdsKey = shared.collaborators
    .map((c) => c.user_id)
    .sort()
    .join(",");
  useEffect(() => {
    // No refetch in solo mode. The collaborator-list row is also gated
    // on `sharedSessionId`, so stale names from a prior shared session
    // are invisible anyway.
    if (!sharedSessionId) return;
    if (collaboratorIdsKey.length === 0) return;
    let cancelled = false;
    (async () => {
      const result = await listCollaboratorNames(sharedSessionId);
      if (cancelled) return;
      if (result.ok) setCollaboratorNames(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [sharedSessionId, collaboratorIdsKey]);

  // Redirect guard: no session → /setup. Wait for hydration to avoid
  // bouncing on the initial render before persisted state is loaded.
  // In shared mode we only redirect on an explicit "not_found" error from
  // the polling endpoint — relying on `!shared.loading` would race the
  // hydration→fetch transition (useState-based `loading` starts `false`
  // when sharedSessionId was null at mount time, which is exactly the
  // post-goto hard-nav path).
  //
  // When not_found fires, clear `sharedSessionId` from Zustand. Without
  // this, /setup's arrival gate (post-plan 2026-04-14) sees the stale id
  // and bounces the user right back to /tracker — an infinite loop.
  // Reconciling local state with server truth is the responsibility of
  // the guards that detect the divergence. useSharedSession already
  // retries once on a 404 to absorb transient auth-cookie refresh races,
  // so reaching this branch means the session is gone.
  useEffect(() => {
    if (!hasHydrated) return;
    if (sharedSessionId) {
      if (shared.error === "not_found") {
        setSharedSessionId(null);
        router.replace("/setup");
      }
      return;
    }
    if (session === null) {
      router.replace("/setup");
    }
  }, [
    hasHydrated,
    session,
    sharedSessionId,
    shared.error,
    setSharedSessionId,
    router,
  ]);

  const totals = useMemo(() => {
    if (!session) {
      return {
        totalValue: 0,
        marginValue: 0,
        gramsConsumed: 0,
        itemsById: new Map<ItemId, Item>(),
        unitsByItemId: new Map<ItemId, number>(),
      };
    }
    const itemsById = new Map<ItemId, Item>();
    for (const item of session.library) itemsById.set(item.id, item);

    const unitsByItemId = new Map<ItemId, number>();
    for (const entry of session.eaten) {
      unitsByItemId.set(entry.itemId, entry.units);
    }

    const { grams: gramsConsumed } = computeFullness(
      session.library,
      session.eaten,
      session.appetiteBudgetGrams,
    );

    return {
      totalValue: totalEatenValue(session),
      marginValue: margin(session),
      gramsConsumed,
      itemsById,
      unitsByItemId,
    };
  }, [session]);

  // Derived values — safe to compute with zero defaults when session is
  // null, so the hook calls below stay unconditional (rules-of-hooks).
  const buffetPrice = session?.buffetPrice ?? 0;
  const appetiteBudgetGrams = session?.appetiteBudgetGrams ?? null;
  const rawPercent =
    buffetPrice > 0 ? (totals.totalValue / buffetPrice) * 100 : 0;
  const cappedPercent = Math.min(100, Math.max(0, rawPercent));
  const fullnessLabel =
    appetiteBudgetGrams != null && appetiteBudgetGrams > 0
      ? `${formatGrams(totals.gramsConsumed)} / ${formatGrams(appetiteBudgetGrams)}`
      : formatGrams(totals.gramsConsumed);
  const wins = buffetPrice > 0 && totals.totalValue >= buffetPrice;
  // Tone (color) reads from the TARGET margin, not the displayed/tweened
  // value, so the color doesn't flicker as the tween crosses zero.
  const marginIsPositive = totals.marginValue >= 0;

  // Animated displays. The underlying state and the e2e regex still see
  // toFixed(2)-formatted strings, just smoothly approaching their target.
  // These hooks MUST be called before any early return (rules-of-hooks).
  const displayedTotal = useAnimatedNumber(totals.totalValue);
  const displayedPercent = useAnimatedNumber(rawPercent);
  const displayedMargin = useAnimatedNumber(totals.marginValue);
  const formattedMargin = `${marginIsPositive ? "+" : "-"}$${Math.abs(
    displayedMargin
  ).toFixed(2)}`;

  // Win-moment pulse: fires only on the false → true transition. The first
  // render seeds prevWins with the current wins value so resuming an
  // already-winning meal doesn't pulse on hydration. winPulseKey is bumped
  // on each transition and used as a React key so the animated element
  // remounts and the CSS keyframe re-fires.
  //
  // Implemented as "adjust state during render" (state + conditional
  // setState in render body) rather than a useEffect, because the lint
  // config forbids set-state-in-effect. React discards the in-progress
  // render and restarts with the updated state.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [winPulseKey, setWinPulseKey] = useState(0);
  const [prevWins, setPrevWins] = useState(wins);
  if (prevWins !== wins) {
    setPrevWins(wins);
    if (!prevWins && wins) {
      setWinPulseKey((k) => k + 1);
    }
  }

  // All hooks are called above. Only now is it safe to bail.
  if (!hasHydrated || session === null) {
    return null;
  }

  async function handleFinish() {
    if (!session) return;
    if (finishPending) return;

    // Shared-session (Phase 6): finalize via the owner-only server action,
    // then route to /result for the celebratory "did you win" view. The
    // historical record lives at /history/[id] and is reachable from the
    // History tab; finishing shouldn't skip past the result screen.
    // Collaborators can't finalize — the server action returns "not_owner".
    // We surface that as an error without locking up the UI.
    if (sharedSessionId) {
      setFinishPending(true);
      setFinishError(null);
      const result = await finalizeSharedSession({ sessionId: sharedSessionId });
      if (!result.ok) {
        setFinishPending(false);
        setFinishError(
          result.error === "not_owner"
            ? "Only the session owner can finish this meal."
            : "Could not save this meal. Please try again.",
        );
        return;
      }
      finishMeal();
      router.push("/result");
      return;
    }

    // Guest (not signed in): keep the pre-Phase-3 behavior — local-only
    // finish, route to /result. Phase 6 promotes these to the DB after
    // first login via finishedSessions.
    if (authUser === false) {
      finishMeal();
      router.push("/result");
      return;
    }

    // Still resolving the client-side auth state on mount (<100ms in
    // practice). Bail — the user can tap Finish again in a moment.
    if (authUser === null) {
      return;
    }

    setFinishPending(true);
    setFinishError(null);
    const result = await finishAndSaveSession({
      clientSessionId: session.id,
      googlePlaceId: session.resolvedPlace?.googlePlaceId,
      restaurantName: session.restaurantName,
      buffetPrice: session.buffetPrice,
      appetiteBudget: session.appetiteBudget,
      library: session.library,
      eaten: session.eaten,
      startedAt: new Date(session.startedAt).toISOString(),
    });
    if (!result.ok) {
      setFinishPending(false);
      setFinishError("Could not save this meal. Please try again.");
      return;
    }
    // Mark the draft as finished (matches the guest flow) and navigate to
    // /result for the celebratory view. The persisted detail page at
    // /history/[id] is reachable from the History tab; finishing shouldn't
    // skip past the result screen. The session lingers in the store with
    // finishedAt set; a future /setup submit overwrites it via startSession.
    finishMeal();
    router.push("/result");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 lg:px-8 lg:grid lg:grid-cols-3 lg:gap-10">
      {sharedSessionId ? (
        <section
          aria-label="Collaborators"
          className="-mx-4 flex items-center justify-between gap-3 border-b border-[rgba(25,28,31,0.08)] bg-white px-4 py-3 text-sm tracking-[0.01em] lg:col-span-3 lg:mx-0 lg:px-0 lg:py-4 dark:border-white/10 dark:bg-[#191c1f]"
        >
          <p className="min-w-0 truncate text-[#191c1f] dark:text-white">
            <span className="text-[#505a63] dark:text-[#8d969e]">
              Eating with:
            </span>{" "}
            {renderCollaboratorRoster(
              shared.collaborators,
              collaboratorNames,
              authUser ? authUser.id : null,
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShareOpen(true)}
          >
            Share
          </Button>
        </section>
      ) : null}
      <section
        aria-label="Live totals"
        aria-live="polite"
        className="sticky top-16 z-30 -mx-4 border-b border-[rgba(25,28,31,0.08)] bg-white px-4 py-5 lg:hidden dark:border-white/10 dark:bg-[#191c1f]"
      >
        <div key={`mobile-pulse-${winPulseKey}`} className={winPulseKey > 0 ? "ayce-win-pulse" : undefined}>
          <Progress
            value={cappedPercent}
            aria-label="Money worth progress"
          />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3 text-sm tracking-[0.01em] tabular-nums">
          <span className="font-medium text-[#191c1f] dark:text-white">
            ${displayedTotal.toFixed(2)} / ${buffetPrice.toFixed(2)}
          </span>
          <span className="font-semibold text-[#191c1f] dark:text-white">
            {Math.round(displayedPercent)}%
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="flex flex-col gap-0.5">
            <dt className="text-[#505a63] dark:text-[#8d969e]">Eaten</dt>
            <dd className="font-semibold tabular-nums text-[#191c1f] dark:text-white">
              ${displayedTotal.toFixed(2)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-[#505a63] dark:text-[#8d969e]">Margin</dt>
            <dd
              className={`font-semibold tabular-nums ${
                marginIsPositive
                  ? "text-[#191c1f] dark:text-white"
                  : "text-[#e23b4a]"
              }`}
            >
              {formattedMargin}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-[#505a63] dark:text-[#8d969e]">Fill</dt>
            <dd className="font-semibold tabular-nums text-[#191c1f] dark:text-white">
              {fullnessLabel}
            </dd>
          </div>
        </dl>
      </section>

      <aside
        aria-label="Live totals"
        aria-live="polite"
        className="hidden lg:col-span-1 lg:sticky lg:top-24 lg:self-start lg:flex lg:flex-col lg:gap-8 lg:py-12"
      >
        <div key={`desktop-pulse-${winPulseKey}`} className={winPulseKey > 0 ? "ayce-win-pulse" : undefined}>
          <Progress
            value={cappedPercent}
            aria-label="Money worth progress"
            className="lg:h-3"
          />
        </div>
        <div className="flex flex-col gap-2">
          <span
            className="font-[var(--font-display)] text-6xl lg:text-7xl font-medium leading-none tracking-[-0.03em] tabular-nums text-[#191c1f] dark:text-white"
          >
            {Math.round(displayedPercent)}%
          </span>
          <span className="text-sm tracking-[0.01em] text-[#505a63] tabular-nums dark:text-[#8d969e]">
            ${displayedTotal.toFixed(2)} of ${buffetPrice.toFixed(2)}
          </span>
        </div>
        <dl className="flex flex-col">
          <div className="flex items-baseline justify-between gap-2 border-t border-[rgba(25,28,31,0.08)] py-4 dark:border-white/10">
            <dt className="text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">Eaten</dt>
            <dd className="text-base font-semibold tabular-nums text-[#191c1f] dark:text-white">
              ${displayedTotal.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t border-[rgba(25,28,31,0.08)] py-4 dark:border-white/10">
            <dt className="text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">Margin</dt>
            <dd
              className={`text-base font-semibold tabular-nums ${
                marginIsPositive
                  ? "text-[#191c1f] dark:text-white"
                  : "text-[#e23b4a]"
              }`}
            >
              {formattedMargin}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t border-[rgba(25,28,31,0.08)] py-4 dark:border-white/10">
            <dt className="text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">Fill</dt>
            <dd className="text-base font-semibold tabular-nums text-[#191c1f] dark:text-white">
              {fullnessLabel}
            </dd>
          </div>
        </dl>
        {session.library.length > 0 ? (
          <div className="flex flex-col gap-3">
            <Button
              type="button"
              onClick={handleFinish}
              size="lg"
              className="w-full"
              disabled={finishPending}
            >
              {finishPending ? "Saving…" : "Finish meal"}
            </Button>
            {finishError ? (
              <p role="alert" className="text-sm text-[#e23b4a]">
                {finishError}
              </p>
            ) : null}
            {logError ? (
              <p role="alert" className="text-sm text-[#e23b4a]">
                {logError}
              </p>
            ) : null}
          </div>
        ) : null}
      </aside>

      <div className="py-8 lg:col-span-2 lg:py-12">
        {session.library.length === 0 ? (
          <div className="mx-auto max-w-md">
            <EmptyState
              title="No items in your library"
              body="Add items first so you can log what you're eating."
              actionHref="/library"
              actionLabel="Go to library"
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-4 lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-5">
            {session.library.map((item) => {
              const units = totals.unitsByItemId.get(item.id) ?? 0;
              return (
                <li key={item.id}>
                  <ItemCard item={item} units={units} onLog={logEaten} />
                </li>
              );
            })}
          </ul>
        )}

        {session.library.length > 0 ? (
          <div className="mt-8 flex flex-col gap-3 lg:hidden">
            <Button
              type="button"
              onClick={handleFinish}
              size="lg"
              className="w-full"
              disabled={finishPending}
            >
              {finishPending ? "Saving…" : "Finish meal"}
            </Button>
            {finishError ? (
              <p role="alert" className="text-sm text-[#e23b4a]">
                {finishError}
              </p>
            ) : null}
            {logError ? (
              <p role="alert" className="text-sm text-[#e23b4a]">
                {logError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {sharedSessionId ? (
        <ShareDrawer
          sharedSessionId={sharedSessionId}
          collaborators={shared.collaborators.map((c) => ({
            userId: c.user_id,
            role: c.role,
          }))}
          currentUserId={authUser ? authUser.id : null}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
    </main>
  );
}

function formatUnits(units: number): string {
  return Number.isInteger(units) ? units.toString() : units.toFixed(1);
}

// Phase 7: render "Eating with: Alice, Bob, You". Own user is bolded
// and pushed last; everyone else is alphabetized by display name so the
// order is stable across polls.
function renderCollaboratorRoster(
  collaborators: ReadonlyArray<{ user_id: string; role: string }>,
  names: ReadonlyArray<CollaboratorName>,
  selfUserId: string | null,
): React.ReactNode {
  if (collaborators.length === 0) return null;
  const byId = new Map(names.map((n) => [n.userId, n.displayName]));

  const others = collaborators
    .filter((c) => c.user_id !== selfUserId)
    .map((c) => byId.get(c.user_id) ?? shortUserId(c.user_id))
    .sort((a, b) => a.localeCompare(b));

  const selfInSession =
    selfUserId !== null &&
    collaborators.some((c) => c.user_id === selfUserId);

  const parts: React.ReactNode[] = others.map((name, i) => (
    <span key={`other-${i}`}>{name}</span>
  ));
  if (selfInSession) {
    parts.push(
      <strong key="you" className="font-semibold">
        You
      </strong>,
    );
  }

  return parts.reduce<React.ReactNode[]>((acc, part, i) => {
    if (i > 0) acc.push(<span key={`sep-${i}`}>, </span>);
    acc.push(part);
    return acc;
  }, []);
}

interface ItemCardProps {
  item: Item;
  units: number;
  onLog: (itemId: ItemId, units: number, grams?: number) => void;
}

function ItemCard({ item, units, onLog }: ItemCardProps) {
  const lineTotal = units * item.alaCarteValue;
  const [gramsOpen, setGramsOpen] = useState(false);
  const [gramsValue, setGramsValue] = useState("");
  const [gramsError, setGramsError] = useState<string | null>(null);
  // Focus returns to the `+g` button after a successful submit. Using a
  // queueMicrotask() callback avoids the setTimeout race plan task 3 warns
  // against — the ref is stable, and React will have unmounted the input
  // by the time the microtask runs.
  const addGramsButtonRef = useRef<HTMLButtonElement>(null);

  function openGrams() {
    setGramsValue("");
    setGramsError(null);
    setGramsOpen(true);
  }

  function closeGramsAndRefocus() {
    setGramsOpen(false);
    setGramsValue("");
    setGramsError(null);
    queueMicrotask(() => {
      addGramsButtonRef.current?.focus();
    });
  }

  function handleGramsSubmit() {
    const parsed = Number(gramsValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setGramsError("Enter a number greater than 0.");
      return;
    }
    onLog(item.id, 0, parsed);
    closeGramsAndRefocus();
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{item.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-2 text-sm tracking-[0.01em]">
          <span className="tabular-nums text-[#505a63] dark:text-[#8d969e]">
            ${item.alaCarteValue.toFixed(2)} · fill {item.fillFactor}/10
          </span>
          <span className="tabular-nums text-[#191c1f] dark:text-white">
            <span className="font-semibold">{formatUnits(units)}</span>{" "}
            <span className="text-[#505a63] dark:text-[#8d969e]">
              (${lineTotal.toFixed(2)})
            </span>
          </span>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Remove one ${item.name}`}
            onClick={() => onLog(item.id, -1)}
            disabled={units === 0}
          >
            −1
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Add half a ${item.name}`}
            onClick={() => onLog(item.id, 0.5)}
          >
            +0.5
          </Button>
          <Button
            type="button"
            size="sm"
            aria-label={`Add one ${item.name}`}
            onClick={() => onLog(item.id, 1)}
          >
            +1
          </Button>
          <Button
            ref={addGramsButtonRef}
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Log grams for ${item.name}`}
            aria-expanded={gramsOpen}
            onClick={openGrams}
            disabled={gramsOpen}
          >
            +g
          </Button>
        </div>
        {gramsOpen ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleGramsSubmit();
            }}
          >
            <label
              htmlFor={`grams-${item.id}`}
              className="text-xs font-medium tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]"
            >
              Grams to log for {item.name}
            </label>
            <Input
              id={`grams-${item.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              autoFocus
              className="h-9 w-24"
              value={gramsValue}
              onChange={(e) => {
                setGramsValue(e.target.value);
                // Clear the error as soon as the user edits — nit from
                // code review. Keeps the form responsive instead of
                // forcing a cancel/resubmit to dismiss stale feedback.
                if (gramsError) setGramsError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeGramsAndRefocus();
                }
              }}
              aria-invalid={gramsError ? true : undefined}
              aria-describedby={
                gramsError ? `grams-${item.id}-error` : undefined
              }
            />
            <Button
              type="submit"
              size="sm"
              aria-label={`Submit grams for ${item.name}`}
            >
              Add
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeGramsAndRefocus}
              aria-label={`Cancel grams input for ${item.name}`}
            >
              Cancel
            </Button>
          </form>
        ) : null}
        {gramsError ? (
          <p
            id={`grams-${item.id}-error`}
            role="alert"
            className="text-xs text-[#e23b4a]"
          >
            {gramsError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string;
  body: string;
  actionHref: string;
  actionLabel: string;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center rounded-[20px] border border-dashed border-[rgba(25,28,31,0.12)] bg-[#f4f4f4] px-6 py-16 text-center dark:border-white/10 dark:bg-[#262a2e]">
      <p className="font-medium text-[#191c1f] dark:text-white">{title}</p>
      <p className="mt-2 text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">{body}</p>
      <Button
        type="button"
        variant="outline"
        onClick={() => router.push(actionHref)}
        className="mt-6"
      >
        {actionLabel}
      </Button>
    </div>
  );
}
