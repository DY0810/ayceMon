"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EatenEntry, Item, Session } from "./types";

// Phase 6 (collab-and-quantitative-appetite): client-side view of a
// server-backed shared session. Polls /api/shared-session/[id] and
// projects the rows into the same `Session` shape the solo flow uses,
// so the tracker/library/result pages render without forking their UI.
//
// IMPORTANT — per-item aggregation rule (single source of truth).
// The shared-session `eaten` list is synthesised from the raw entries
// table by summing `units` per `item_id` across ALL collaborators.
// That keeps the tracker's "units eaten / value" display consistent
// with computeTotals (which operates on `EatenEntry[]`). The per-user
// breakdown used by contributors jsonb at finalize time is derived
// separately by finalizeSharedSession.

const POLL_INTERVAL_MS = 2500;
const LOG_POLL_AFTER_WRITE_MS = 300;

interface SharedSessionApi {
  session: {
    id: string;
    owner_user_id: string;
    restaurant_id: string | null;
    restaurant_name: string | null;
    buffet_price: string | number;
    appetite_budget: number | null;
    appetite_budget_grams: string | number | null;
    city_tier: string | null;
    resolved_place: unknown;
    started_at: string;
    finished_at: string | null;
    created_at: string;
  };
  items: Array<{
    id: string;
    session_id: string;
    name: string;
    ala_carte_value: string | number;
    fill_factor: string | number;
    grams_per_unit: string | number | null;
    category: string | null;
    source_kind: string | null;
    source_ref: string | null;
  }>;
  entries: Array<{
    id: string;
    session_id: string;
    user_id: string;
    item_id: string;
    units: string | number;
    grams: string | number | null;
    logged_at: string;
  }>;
  collaborators: Array<{
    session_id: string;
    user_id: string;
    role: string;
    joined_at: string;
  }>;
}

export interface SharedSessionView {
  session: Session | null;
  collaborators: SharedSessionApi["collaborators"];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function mapApiToSession(data: SharedSessionApi): Session {
  const library: Item[] = data.items.map((r) => ({
    id: r.id,
    name: r.name,
    alaCarteValue: Number(r.ala_carte_value),
    fillFactor: Number(r.fill_factor),
    gramsPerUnit:
      r.grams_per_unit === null ? undefined : Number(r.grams_per_unit),
    category: r.category ?? undefined,
    sourceKind:
      r.source_kind === "user" ||
      r.source_kind === "seed" ||
      r.source_kind === "estimate"
        ? r.source_kind
        : undefined,
    sourceRef: r.source_ref ?? undefined,
  }));

  // Aggregate per-item units across all collaborators so the tracker's
  // "units by item" display shows the shared tally. We intentionally do
  // NOT preserve per-user grams on this view — computeFullness falls
  // back to units × gramsPerUnit when entry.grams is undefined, which
  // is the right behaviour for the aggregate display.
  const perItemUnits = new Map<string, number>();
  const perItemGrams = new Map<string, number | undefined>();
  for (const e of data.entries) {
    const units = Number(e.units);
    perItemUnits.set(
      e.item_id,
      (perItemUnits.get(e.item_id) ?? 0) + (Number.isFinite(units) ? units : 0),
    );
    if (e.grams !== null) {
      const g = Number(e.grams);
      if (Number.isFinite(g)) {
        perItemGrams.set(e.item_id, (perItemGrams.get(e.item_id) ?? 0) + g);
      }
    }
  }
  const eaten: EatenEntry[] = Array.from(perItemUnits.entries()).map(
    ([itemId, units]) => {
      const grams = perItemGrams.get(itemId);
      return grams === undefined ? { itemId, units } : { itemId, units, grams };
    },
  );

  const s = data.session;
  return {
    id: s.id,
    restaurantName: s.restaurant_name ?? undefined,
    buffetPrice: Number(s.buffet_price),
    appetiteBudget: s.appetite_budget ?? 0,
    appetiteBudgetGrams:
      s.appetite_budget_grams === null ? null : Number(s.appetite_budget_grams),
    library,
    eaten,
    startedAt: Date.parse(s.started_at),
    finishedAt: s.finished_at ? Date.parse(s.finished_at) : undefined,
    cityTier:
      s.city_tier === "metro-premium" ||
      s.city_tier === "metro-standard" ||
      s.city_tier === "suburban" ||
      s.city_tier === "rural"
        ? s.city_tier
        : undefined,
    // resolvedPlace is display-only here; omit to avoid widening the type
    // with untrusted jsonb. Consumers reading it server-side already
    // re-fetch Places Details.
  };
}

export function useSharedSession(
  sharedSessionId: string | null,
): SharedSessionView {
  const [session, setSession] = useState<Session | null>(null);
  const [collaborators, setCollaborators] = useState<
    SharedSessionApi["collaborators"]
  >([]);
  const [loading, setLoading] = useState<boolean>(Boolean(sharedSessionId));
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const fetchOnce = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/shared-session/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(res.status === 404 ? "not_found" : "fetch_failed");
        return;
      }
      const data = (await res.json()) as SharedSessionApi;
      if (cancelledRef.current) return;
      setSession(mapApiToSession(data));
      setCollaborators(data.collaborators);
      setError(null);
    } catch {
      if (!cancelledRef.current) setError("fetch_failed");
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    if (!sharedSessionId) {
      setSession(null);
      setCollaborators([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    fetchOnce(sharedSessionId);
    const interval = setInterval(
      () => fetchOnce(sharedSessionId),
      POLL_INTERVAL_MS,
    );
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [sharedSessionId, fetchOnce]);

  const refresh = useCallback(async () => {
    if (!sharedSessionId) return;
    // Short debounce so writers can chain calls without thrashing the route.
    await new Promise((r) => setTimeout(r, LOG_POLL_AFTER_WRITE_MS));
    await fetchOnce(sharedSessionId);
  }, [sharedSessionId, fetchOnce]);

  return { session, collaborators, loading, error, refresh };
}
