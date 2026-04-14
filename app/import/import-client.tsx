"use client";

import { useState } from "react";
import Link from "next/link";

import { promoteGuestSessions } from "@/app/actions/migrate";
import { RestaurantCombobox } from "@/components/restaurant-combobox";
import { Button } from "@/components/ui/button";
import { useAyceStore } from "@/lib/store";
import type { ResolvedPlace, Session } from "@/lib/types";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCurrency(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}

interface RowState {
  resolvedPlace: ResolvedPlace | undefined;
  manualName: string;
  saving: boolean;
  error: string | null;
}

export function ImportClient() {
  const finishedSessions = useAyceStore((s) => s.finishedSessions);
  const removeFinishedSession = useAyceStore((s) => s.removeFinishedSession);
  const hasHydrated = useAyceStore((s) => s._hasHydrated);

  // Per-row UI state keyed by session id.
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  if (!hasHydrated) {
    return (
      <div className="text-sm text-[#505a63] dark:text-[#8d969e]">
        Loading...
      </div>
    );
  }

  // Only show sessions that need resolution: no resolvedPlace, or previously
  // failed (they're still in finishedSessions because removeFinishedSession
  // wasn't called).
  const importable = finishedSessions.filter((s) => !s.resolvedPlace);

  if (importable.length === 0 && finishedSessions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-[#505a63] dark:text-[#8d969e]">
          Nothing to import.
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-[#191c1f] underline-offset-2 hover:underline dark:text-white"
        >
          Back to home
        </Link>
      </div>
    );
  }

  // Also show sessions that DO have a resolvedPlace but are still in the
  // store (they may have failed during the auto-migration).
  const allPending = finishedSessions;

  function getRowState(id: string): RowState {
    return (
      rowStates[id] ?? {
        resolvedPlace: undefined,
        manualName: "",
        saving: false,
        error: null,
      }
    );
  }

  function updateRow(id: string, patch: Partial<RowState>) {
    setRowStates((prev) => ({
      ...prev,
      [id]: { ...getRowState(id), ...patch },
    }));
  }

  async function handleSave(session: Session) {
    const row = getRowState(session.id);
    const place = row.resolvedPlace ?? session.resolvedPlace;
    if (!place) return;

    updateRow(session.id, { saving: true, error: null });

    const patched: Session = { ...session, resolvedPlace: place };

    try {
      const result = await promoteGuestSessions([patched]);
      if (result.promoted.includes(session.id)) {
        removeFinishedSession(session.id);
      } else {
        const fail = result.failed.find((f) => f.id === session.id);
        updateRow(session.id, {
          saving: false,
          error: fail?.error ?? "Unknown error",
        });
      }
    } catch {
      updateRow(session.id, { saving: false, error: "Network error" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {allPending.map((session) => {
        const row = getRowState(session.id);
        const hasPlace = !!(row.resolvedPlace ?? session.resolvedPlace);

        return (
          <div
            key={session.id}
            className="rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white p-5 dark:border-white/10 dark:bg-[#191c1f]"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm text-[#505a63] dark:text-[#8d969e]">
                  {formatDate(session.startedAt)}
                </div>
                <div className="mt-1 text-base font-medium text-[#191c1f] dark:text-white">
                  {session.restaurantName ?? "Unknown restaurant"} &middot;{" "}
                  {formatCurrency(session.buffetPrice)} buffet
                </div>
                <div className="mt-0.5 text-sm text-[#505a63] dark:text-[#8d969e]">
                  {session.eaten.length} item
                  {session.eaten.length === 1 ? "" : "s"} eaten
                </div>
              </div>
            </div>

            {!session.resolvedPlace ? (
              <div className="mt-4">
                <RestaurantCombobox
                  resolvedPlace={row.resolvedPlace}
                  onResolvedPlaceChange={(p) =>
                    updateRow(session.id, { resolvedPlace: p })
                  }
                  manualName={row.manualName}
                  onManualNameChange={(v) =>
                    updateRow(session.id, { manualName: v })
                  }
                />
              </div>
            ) : null}

            {row.error ? (
              <p className="mt-2 text-sm text-[#e23b4a]">{row.error}</p>
            ) : null}

            <div className="mt-4">
              <Button
                type="button"
                disabled={!hasPlace || row.saving}
                onClick={() => void handleSave(session)}
              >
                {row.saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
