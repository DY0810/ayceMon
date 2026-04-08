"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { suggestTopN, type ComboSuggestion } from "@/lib/optimizer";
import { useAyceStore } from "@/lib/store";
import type { Item } from "@/lib/types";

export default function CombosPage() {
  const router = useRouter();
  const session = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);
  const clearEaten = useAyceStore((state) => state.clearEaten);
  const logEaten = useAyceStore((state) => state.logEaten);

  // Redirect guard: no session → /setup. Wait for hydration.
  useEffect(() => {
    if (hasHydrated && session === null) {
      router.replace("/setup");
    }
  }, [hasHydrated, session, router]);

  // Memoize the optimizer call. Re-run only when the inputs change.
  const combos = useMemo(() => {
    if (!session) return [];
    return suggestTopN(session, 3);
  }, [session]);

  const itemsById = useMemo(() => {
    const map = new Map<string, Item>();
    if (session) {
      for (const item of session.library) map.set(item.id, item);
    }
    return map;
  }, [session]);

  if (!hasHydrated || session === null) {
    return null;
  }

  function applyCombo(combo: ComboSuggestion) {
    clearEaten();
    for (const pick of combo.picks) {
      logEaten(pick.itemId, pick.units);
    }
    router.push("/tracker");
  }

  const buffetPrice = session.buffetPrice;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">
            Combos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pre-meal targets to clear ${buffetPrice.toFixed(2)}.
          </p>
        </div>
        <p className="hidden text-sm text-muted-foreground lg:block">
          Appetite budget: {session.appetiteBudget} fill units
        </p>
      </div>

      {session.library.length === 0 ? (
        <div className="mx-auto max-w-md">
          <EmptyState
            title="No items in your library"
            body="Add items first so we can suggest combos."
            actionHref="/library"
            actionLabel="Go to library"
          />
        </div>
      ) : combos.length === 0 || combos[0].picks.length === 0 ? (
        <div className="mx-auto max-w-md">
          <EmptyState
            title="Nothing fits your appetite budget"
            body="Lower the fill factors or raise your appetite budget to get suggestions."
            actionHref="/setup"
            actionLabel="Edit setup"
          />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {combos.map((combo, index) => {
            const wins = combo.totalValue >= buffetPrice;
            return (
              <li key={index}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span>Combo {index + 1}</span>
                      {wins ? (
                        <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                          <Check aria-hidden />
                          Beats buffet
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <X aria-hidden />
                          Falls short
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <div className="font-heading text-3xl font-semibold tabular-nums text-foreground">
                          ${combo.totalValue.toFixed(2)}
                        </div>
                        <div
                          className={`text-xs tabular-nums ${
                            wins ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
                          }`}
                        >
                          vs ${buffetPrice.toFixed(2)} buffet ·{" "}
                          {wins
                            ? `+$${(combo.totalValue - buffetPrice).toFixed(2)}`
                            : `-$${(buffetPrice - combo.totalValue).toFixed(2)}`}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground tabular-nums">
                        fill {combo.totalFill}/{session.appetiteBudget}
                      </div>
                    </div>
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                      aria-hidden
                    >
                      <div
                        className={`h-full rounded-full ${
                          wins ? "bg-emerald-500" : "bg-foreground/60"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            buffetPrice > 0
                              ? (combo.totalValue / buffetPrice) * 100
                              : 0
                          )}%`,
                        }}
                      />
                    </div>
                    <ul className="flex flex-col gap-1">
                      {combo.picks.map((pick) => {
                        const item = itemsById.get(pick.itemId);
                        if (!item) return null;
                        return (
                          <li
                            key={pick.itemId}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="text-foreground">
                              <span className="tabular-nums text-muted-foreground">
                                {pick.units}×
                              </span>{" "}
                              {item.name}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              ${(item.alaCarteValue * pick.units).toFixed(2)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Button
                      type="button"
                      onClick={() => applyCombo(combo)}
                      className="h-11 w-full text-base"
                    >
                      Use this combo
                    </Button>
                  </CardFooter>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
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
