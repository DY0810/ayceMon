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
  // Post-plan gate (2026-04-14): /combos is solo-only. The optimizer reads
  // the Zustand `session` which isn't populated in shared/invite mode, so
  // a shared-mode user landing here would see an empty combo list. Kick
  // them back to /tracker (the canonical in-session surface for shared).
  const sharedSessionId = useAyceStore((state) => state.sharedSessionId);

  // Redirect guards: shared mode → /tracker; no session → /setup. Wait
  // for hydration so we don't race the zustand persist rehydration.
  useEffect(() => {
    if (!hasHydrated) return;
    if (sharedSessionId !== null) {
      router.replace("/tracker");
      return;
    }
    if (session === null) {
      router.replace("/setup");
    }
  }, [hasHydrated, session, sharedSessionId, router]);

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

  if (!hasHydrated || session === null || sharedSessionId !== null) {
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
    <main className="mx-auto w-full max-w-6xl px-4 py-10 lg:px-8 lg:py-16">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-[var(--font-display)] text-3xl font-medium leading-tight tracking-tight text-[#191c1f] lg:text-5xl dark:text-white">
            Combos
          </h1>
          <p className="mt-2 text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
            Pre-meal targets to clear ${buffetPrice.toFixed(2)}.
          </p>
        </div>
        <p className="hidden text-sm tracking-[0.01em] text-[#505a63] lg:block dark:text-[#8d969e]">
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
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {combos.map((combo, index) => {
            const wins = combo.totalValue >= buffetPrice;
            return (
              <li key={index}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span>Combo {index + 1}</span>
                      {wins ? (
                        <Badge className="gap-1">
                          <Check aria-hidden />
                          Beats buffet
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <X aria-hidden />
                          Falls short
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <div className="font-[var(--font-display)] text-4xl font-medium leading-none tracking-tight tabular-nums text-[#191c1f] dark:text-white">
                          ${combo.totalValue.toFixed(2)}
                        </div>
                        <div className="mt-2 text-xs tracking-[0.01em] tabular-nums text-[#505a63] dark:text-[#8d969e]">
                          vs ${buffetPrice.toFixed(2)} buffet ·{" "}
                          {wins
                            ? `+$${(combo.totalValue - buffetPrice).toFixed(2)}`
                            : `-$${(buffetPrice - combo.totalValue).toFixed(2)}`}
                        </div>
                      </div>
                      <div className="text-right text-xs text-[#505a63] tabular-nums dark:text-[#8d969e]">
                        fill {combo.totalFill}/{session.appetiteBudget}
                      </div>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-[#f4f4f4] dark:bg-[#262a2e]"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-[#191c1f] dark:bg-white"
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
                    <ul className="flex flex-col gap-1.5">
                      {combo.picks.map((pick) => {
                        const item = itemsById.get(pick.itemId);
                        if (!item) return null;
                        return (
                          <li
                            key={pick.itemId}
                            className="flex items-center justify-between gap-2 text-sm tracking-[0.01em]"
                          >
                            <span className="text-[#191c1f] dark:text-white">
                              <span className="tabular-nums text-[#505a63] dark:text-[#8d969e]">
                                {pick.units}×
                              </span>{" "}
                              {item.name}
                            </span>
                            <span className="tabular-nums text-[#505a63] dark:text-[#8d969e]">
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
                      className="w-full"
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
