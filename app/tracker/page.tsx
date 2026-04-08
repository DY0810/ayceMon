"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { margin, totalEatenValue } from "@/lib/calc";
import { useAyceStore } from "@/lib/store";
import type { Item, ItemId } from "@/lib/types";
import { useAnimatedNumber } from "@/lib/use-animated-number";

export default function TrackerPage() {
  const router = useRouter();
  const session = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);
  const logEaten = useAyceStore((state) => state.logEaten);
  const finishMeal = useAyceStore((state) => state.finishMeal);

  // Redirect guard: no session → /setup. Wait for hydration to avoid
  // bouncing on the initial render before persisted state is loaded.
  useEffect(() => {
    if (hasHydrated && session === null) {
      router.replace("/setup");
    }
  }, [hasHydrated, session, router]);

  const totals = useMemo(() => {
    if (!session) {
      return {
        totalValue: 0,
        marginValue: 0,
        unitsConsumed: 0,
        itemsById: new Map<ItemId, Item>(),
        unitsByItemId: new Map<ItemId, number>(),
      };
    }
    const itemsById = new Map<ItemId, Item>();
    for (const item of session.library) itemsById.set(item.id, item);

    const unitsByItemId = new Map<ItemId, number>();
    let unitsConsumed = 0;
    for (const entry of session.eaten) {
      unitsByItemId.set(entry.itemId, entry.units);
      const item = itemsById.get(entry.itemId);
      if (item) unitsConsumed += entry.units * item.fillFactor;
    }

    return {
      totalValue: totalEatenValue(session),
      marginValue: margin(session),
      unitsConsumed,
      itemsById,
      unitsByItemId,
    };
  }, [session]);

  if (!hasHydrated || session === null) {
    return null;
  }

  const buffetPrice = session.buffetPrice;
  const appetiteBudget = session.appetiteBudget;
  const rawPercent =
    buffetPrice > 0 ? (totals.totalValue / buffetPrice) * 100 : 0;
  const cappedPercent = Math.min(100, Math.max(0, rawPercent));
  const wins = totals.totalValue >= buffetPrice;
  // Tone (color) reads from the TARGET margin, not the displayed/tweened
  // value, so the color doesn't flicker as the tween crosses zero.
  const marginIsPositive = totals.marginValue >= 0;

  // Animated displays. The underlying state and the e2e regex still see
  // toFixed(2)-formatted strings, just smoothly approaching their target.
  const displayedTotal = useAnimatedNumber(totals.totalValue);
  const displayedPercent = useAnimatedNumber(rawPercent);
  const displayedMargin = useAnimatedNumber(totals.marginValue);
  const formattedMargin = `${marginIsPositive ? "+" : "-"}$${Math.abs(
    displayedMargin
  ).toFixed(2)}`;

  // Win-moment pulse: fires only on the false → true transition. The first
  // render seeds prevWinsRef so resuming an already-winning meal doesn't
  // pulse on hydration. winPulseKey is bumped on each transition and used as
  // a React key so the animated element remounts and the CSS keyframe re-fires.
  const prevWinsRef = useRef(wins);
  const [winPulseKey, setWinPulseKey] = useState(0);
  useEffect(() => {
    if (!prevWinsRef.current && wins) {
      setWinPulseKey((k) => k + 1);
    }
    prevWinsRef.current = wins;
  }, [wins]);

  function handleFinish() {
    finishMeal();
    router.push("/result");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 lg:px-8 lg:grid lg:grid-cols-3 lg:gap-8">
      <section
        aria-label="Live totals"
        aria-live="polite"
        className="sticky top-14 z-30 -mx-4 border-b bg-background/80 px-4 py-4 backdrop-blur supports-backdrop-filter:bg-background/60 lg:hidden"
      >
        <div key={`mobile-pulse-${winPulseKey}`} className={winPulseKey > 0 ? "ayce-win-pulse" : undefined}>
          <Progress
            value={cappedPercent}
            aria-label="Money worth progress"
            className={
              wins
                ? "[&_[data-slot=progress-indicator]]:bg-emerald-500"
                : undefined
            }
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-3 text-sm tabular-nums">
          <span className="font-medium text-foreground">
            ${displayedTotal.toFixed(2)} / ${buffetPrice.toFixed(2)}
          </span>
          <span
            className={
              wins
                ? "font-semibold text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
            }
          >
            {Math.round(displayedPercent)}%
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Eaten</dt>
            <dd className="font-semibold tabular-nums text-foreground">
              ${displayedTotal.toFixed(2)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Margin</dt>
            <dd
              className={`font-semibold tabular-nums ${
                marginIsPositive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              }`}
            >
              {formattedMargin}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Fill</dt>
            <dd className="font-semibold tabular-nums text-foreground">
              {formatUnits(totals.unitsConsumed)} / {appetiteBudget}
            </dd>
          </div>
        </dl>
      </section>

      <aside
        aria-label="Live totals"
        aria-live="polite"
        className="hidden lg:col-span-1 lg:sticky lg:top-20 lg:self-start lg:flex lg:flex-col lg:gap-6 lg:py-8"
      >
        <div key={`desktop-pulse-${winPulseKey}`} className={winPulseKey > 0 ? "ayce-win-pulse" : undefined}>
          <Progress
            value={cappedPercent}
            aria-label="Money worth progress"
            className={`lg:h-3 ${
              wins
                ? "[&_[data-slot=progress-indicator]]:bg-emerald-500"
                : ""
            }`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span
            className={`font-heading text-5xl lg:text-6xl font-semibold tabular-nums ${
              wins
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-foreground"
            }`}
          >
            {Math.round(displayedPercent)}%
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            ${displayedTotal.toFixed(2)} of ${buffetPrice.toFixed(2)}
          </span>
        </div>
        <dl className="flex flex-col">
          <div className="flex items-baseline justify-between gap-2 border-t py-3">
            <dt className="text-sm text-muted-foreground">Eaten</dt>
            <dd className="text-base font-semibold tabular-nums text-foreground">
              ${displayedTotal.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t py-3">
            <dt className="text-sm text-muted-foreground">Margin</dt>
            <dd
              className={`text-base font-semibold tabular-nums ${
                marginIsPositive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              }`}
            >
              {formattedMargin}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t py-3">
            <dt className="text-sm text-muted-foreground">Fill</dt>
            <dd className="text-base font-semibold tabular-nums text-foreground">
              {formatUnits(totals.unitsConsumed)} / {appetiteBudget}
            </dd>
          </div>
        </dl>
        {session.library.length > 0 ? (
          <Button
            type="button"
            onClick={handleFinish}
            className="h-12 w-full text-base"
          >
            Finish meal
          </Button>
        ) : null}
      </aside>

      <div className="py-5 lg:col-span-2 lg:py-8">
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
          <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-4">
            {session.library.map((item) => {
              const units = totals.unitsByItemId.get(item.id) ?? 0;
              const lineTotal = units * item.alaCarteValue;
              return (
                <li key={item.id}>
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>{item.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="tabular-nums text-muted-foreground">
                          ${item.alaCarteValue.toFixed(2)} · fill{" "}
                          {item.fillFactor}/10
                        </span>
                        <span className="tabular-nums text-foreground">
                          <span className="font-semibold">
                            {formatUnits(units)}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            (${lineTotal.toFixed(2)})
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`Remove one ${item.name}`}
                          onClick={() => logEaten(item.id, -1)}
                          disabled={units === 0}
                          className="h-11 min-w-11 px-3 text-base"
                        >
                          −1
                        </Button>
                        <Button
                          type="button"
                          aria-label={`Add half a ${item.name}`}
                          onClick={() => logEaten(item.id, 0.5)}
                          className="h-11 min-w-11 px-3 text-base"
                        >
                          +0.5
                        </Button>
                        <Button
                          type="button"
                          aria-label={`Add one ${item.name}`}
                          onClick={() => logEaten(item.id, 1)}
                          className="h-11 min-w-11 px-3 text-base"
                        >
                          +1
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        {session.library.length > 0 ? (
          <div className="mt-6 lg:hidden">
            <Button
              type="button"
              onClick={handleFinish}
              className="h-12 w-full text-base"
            >
              Finish meal
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function formatUnits(units: number): string {
  return Number.isInteger(units) ? units.toString() : units.toFixed(1);
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 px-4 py-12 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Button
        type="button"
        variant="outline"
        onClick={() => router.push(actionHref)}
        className="mt-4 h-11 px-4 text-base"
      >
        {actionLabel}
      </Button>
    </div>
  );
}
