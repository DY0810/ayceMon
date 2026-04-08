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
import { didYouWin, margin, totalEatenValue } from "@/lib/calc";
import { useAyceStore } from "@/lib/store";
import type { Item, ItemId } from "@/lib/types";

// Threshold for the "right on the line" headline (anti-pattern guard
// from PLAN.md Phase 5: don't celebrate or mourn pennies).
const LINE_EPSILON = 0.5;

interface BreakdownRow {
  itemId: ItemId;
  name: string;
  units: number;
  perUnitValue: number;
  lineTotal: number;
}

export default function ResultPage() {
  const router = useRouter();
  const session = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);
  const endSession = useAyceStore((state) => state.endSession);
  const resumeMeal = useAyceStore((state) => state.resumeMeal);

  // Redirect guard: no session → /setup. Wait for hydration to avoid
  // bouncing on the initial render before persisted state is loaded.
  useEffect(() => {
    if (hasHydrated && session === null) {
      router.replace("/setup");
    }
  }, [hasHydrated, session, router]);

  const summary = useMemo(() => {
    if (!session) {
      return {
        totalValue: 0,
        marginValue: 0,
        wins: false,
        rows: [] as BreakdownRow[],
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
      });
    }

    return {
      totalValue: totalEatenValue(session),
      marginValue: margin(session),
      wins: didYouWin(session),
      rows,
    };
  }, [session]);

  if (!hasHydrated || session === null) {
    return null;
  }

  const { totalValue, marginValue, wins, rows } = summary;
  const buffetPrice = session.buffetPrice;

  const onTheLine = Math.abs(marginValue) <= LINE_EPSILON;
  const headline = onTheLine
    ? "Right on the line."
    : wins
    ? `You won! +$${marginValue.toFixed(2)}`
    : `Almost — you were $${Math.abs(marginValue).toFixed(2)} short.`;

  const headlineTone = onTheLine
    ? "text-foreground"
    : wins
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-destructive";

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
    <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
      <section aria-label="Result headline" className="mb-5 lg:mb-8">
        <h1
          className={`font-heading text-3xl font-semibold tracking-tight lg:text-6xl ${headlineTone}`}
        >
          {headline}
        </h1>
        {session.restaurantName ? (
          <p className="mt-1 text-sm text-muted-foreground lg:text-base">
            {session.restaurantName}
          </p>
        ) : null}
      </section>

      {rows.length > 0 ? (
        <div
          aria-label="Eaten vs buffet price"
          className="mb-5 hidden lg:block"
        >
          <div className="relative h-10 w-full overflow-hidden rounded-lg bg-muted lg:h-14">
            <div
              className={`h-full transition-all duration-300 ${
                wins ? "bg-emerald-500" : "bg-foreground"
              }`}
              style={{ width: `${fillPercent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-sm tabular-nums text-muted-foreground">
            <span>${totalValue.toFixed(2)} eaten</span>
            <span>of ${buffetPrice.toFixed(2)} buffet</span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-8">
        <Card className="order-2 mb-0 hidden lg:order-1 lg:flex">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex w-full flex-col text-sm tabular-nums lg:text-base">
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-foreground/10 lg:py-3 lg:first:border-t-0">
                <dt className="text-muted-foreground">Total eaten</dt>
                <dd className="font-medium text-foreground">
                  ${totalValue.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-foreground/10 lg:py-3">
                <dt className="text-muted-foreground">Buffet price</dt>
                <dd className="font-medium text-foreground">
                  ${buffetPrice.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-foreground/10 lg:py-3">
                <dt className="text-muted-foreground">Margin</dt>
                <dd
                  className={`font-semibold ${
                    onTheLine
                      ? "text-foreground"
                      : marginIsPositive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive"
                  }`}
                >
                  {formattedMargin}
                </dd>
              </div>
            </dl>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-2">
            <Button
              type="button"
              onClick={handleEndSession}
              className="h-11 w-full text-base"
            >
              End session
            </Button>
            <Button
              type="button"
              onClick={handleEditLog}
              variant="outline"
              className="h-11 w-full text-base"
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
              <p className="text-sm text-muted-foreground">
                You didn&apos;t log anything this meal.
              </p>
            ) : (
              <table className="w-full table-fixed text-sm tabular-nums lg:text-base">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground lg:text-sm">
                    <th scope="col" className="w-auto py-1 pr-2 font-medium">
                      Item
                    </th>
                    <th scope="col" className="w-12 py-1 px-2 text-right font-medium">
                      Units
                    </th>
                    <th scope="col" className="w-16 py-1 px-2 text-right font-medium">
                      Per unit
                    </th>
                    <th scope="col" className="w-20 py-1 pl-2 text-right font-medium">
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.itemId} className="border-t border-foreground/10">
                      <td className="py-1.5 pr-2 text-foreground break-words lg:py-2.5">
                        {row.name}
                      </td>
                      <td className="py-1.5 px-2 text-right text-foreground lg:py-2.5">
                        {formatUnits(row.units)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-muted-foreground lg:py-2.5">
                        ${row.perUnitValue.toFixed(2)}
                      </td>
                      <td className="py-1.5 pl-2 text-right font-medium text-foreground lg:py-2.5">
                        ${row.lineTotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
          <CardFooter className="lg:hidden">
            <dl className="flex w-full flex-col gap-1 text-sm tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Total eaten</dt>
                <dd className="font-medium text-foreground">
                  ${totalValue.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Buffet price</dt>
                <dd className="font-medium text-foreground">
                  ${buffetPrice.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Margin</dt>
                <dd
                  className={`font-semibold ${
                    onTheLine
                      ? "text-foreground"
                      : marginIsPositive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive"
                  }`}
                >
                  {formattedMargin}
                </dd>
              </div>
            </dl>
          </CardFooter>
        </Card>

        <div className="order-3 flex flex-col gap-2 lg:hidden">
          <Button
            type="button"
            onClick={handleEditLog}
            variant="outline"
            className="h-11 w-full text-base"
          >
            Edit log
          </Button>
          <Button
            type="button"
            onClick={handleEndSession}
            className="h-11 w-full text-base"
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
