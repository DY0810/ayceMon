"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { aggregateActivity } from "./aggregate-activity";
import { aggregateContributors } from "./aggregate-contributors";
import type {
  EatenEntry,
  Item,
  LiveActivityEvent,
  LiveContributor,
  Session,
} from "./types";

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
// Short retry on a 404 response to absorb transient auth-cookie refresh
// races. A permanent 404 (stale session id) still surfaces after the
// retry fails; a flaky 404 sandwiched between successful polls no longer
// triggers the redirect-loop guards in /tracker and /result.
const NOT_FOUND_RETRY_DELAY_MS = 400;

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
  contributors: readonly LiveContributor[];
  activity: readonly LiveActivityEvent[];
  /** Epoch ms of the last successful poll. Seeded to mount time so
   *  relative-time consumers have a valid reference on first render,
   *  before the first fetch resolves. Only advances on success; a failed
   *  poll leaves this stale so stale-time labels don't silently "freeze"
   *  at a later instant than the data they annotate. */
  lastPolledAt: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export interface UseSharedSessionOptions {
  /** Optional user_id → display-name map (email local-part, etc.). Omitted
   *  entries fall back to the first 8 chars of the user_id via shortUserId.
   *  The hook intentionally does NOT fetch names itself — callers that need
   *  them already own the `listCollaboratorNames` roundtrip.
   *
   *  IMPORTANT: pass a STABLE reference (wrap in useMemo or hoist to a
   *  module constant). A fresh `new Map(...)` on every render makes the
   *  `contributors` memo recompute on every parent render instead of only
   *  on poll updates. It does NOT cause a refetch loop, but it wastes work. */
  displayNameById?: ReadonlyMap<string, string>;
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
    // Null-budget shared sessions use 50 (the legacy-column median that
    // finalizeSharedSession writes when persisting). 0 would divide-by-zero
    // the tracker's "units / budget" display; using 50 keeps the display
    // and the persisted row consistent.
    appetiteBudget: s.appetite_budget ?? 50,
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
  options?: UseSharedSessionOptions,
): SharedSessionView {
  const [session, setSession] = useState<Session | null>(null);
  const [collaborators, setCollaborators] = useState<
    SharedSessionApi["collaborators"]
  >([]);
  // `contributors` is derived from the same payload that feeds `session`
  // (see fetchOnce below). We store the raw payload pieces needed by the
  // aggregation, then fold `displayNameById` in via a `useMemo` so a change
  // to the names map doesn't force a refetch. No second polling useEffect.
  const [rawItems, setRawItems] = useState<SharedSessionApi["items"]>([]);
  const [rawEntries, setRawEntries] = useState<SharedSessionApi["entries"]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(sharedSessionId));
  const [error, setError] = useState<string | null>(null);
  // Mount-time seed keeps first-paint relative-time labels sane before the
  // first fetch resolves. Advanced only on a successful response — see
  // fetchOnce below for rationale.
  const [lastPolledAt, setLastPolledAt] = useState<number>(() => Date.now());
  const displayNameById = options?.displayNameById;
  // Latest-requested id. In-flight fetches close over a local `id` snapshot
  // and compare against this ref on resolve so a stale response can't write
  // over the state for a newer id.
  const activeIdRef = useRef<string | null>(sharedSessionId);

  const fetchOnce = useCallback(async (id: string) => {
    async function fetchRaw(): Promise<Response> {
      return fetch(`/api/shared-session/${id}`, { cache: "no-store" });
    }
    try {
      let res = await fetchRaw();
      if (activeIdRef.current !== id) return;
      // Retry a 404 once after a short delay. A 404 from RLS can be a
      // transient cookie-refresh race (auth.uid() briefly null between
      // the old and new token) rather than a genuinely missing session.
      // Surfacing "not_found" on a flaky 404 would trip the /tracker and
      // /result redirect guards and bounce the user off a valid session.
      if (res.status === 404) {
        await new Promise((r) => setTimeout(r, NOT_FOUND_RETRY_DELAY_MS));
        if (activeIdRef.current !== id) return;
        res = await fetchRaw();
        if (activeIdRef.current !== id) return;
      }
      if (!res.ok) {
        setError(res.status === 404 ? "not_found" : "fetch_failed");
        return;
      }
      const data = (await res.json()) as SharedSessionApi;
      if (activeIdRef.current !== id) return;
      setSession(mapApiToSession(data));
      setCollaborators(data.collaborators);
      setRawItems(data.items);
      setRawEntries(data.entries);
      // Stamp the poll instant here (post-await, inside an async callback
      // invoked by setInterval/useEffect — not during render), so the
      // ActivityFeed can key its relative-time labels off a value that
      // advances on the hook's heartbeat without calling Date.now() in
      // the render path.
      setLastPolledAt(Date.now());
      setError(null);
    } catch {
      if (activeIdRef.current === id) setError("fetch_failed");
    } finally {
      if (activeIdRef.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    activeIdRef.current = sharedSessionId;
    if (!sharedSessionId) {
      setSession(null);
      setCollaborators([]);
      setRawItems([]);
      setRawEntries([]);
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
      // Mark in-flight fetches for this id as stale. The next effect run
      // (or unmount cleanup) sets activeIdRef to the new id / null.
      if (activeIdRef.current === sharedSessionId) {
        activeIdRef.current = null;
      }
      clearInterval(interval);
    };
  }, [sharedSessionId, fetchOnce]);

  const refresh = useCallback(async () => {
    if (!sharedSessionId) return;
    // Short debounce so writers can chain calls without thrashing the route.
    await new Promise((r) => setTimeout(r, LOG_POLL_AFTER_WRITE_MS));
    await fetchOnce(sharedSessionId);
  }, [sharedSessionId, fetchOnce]);

  const contributors = useMemo(
    () =>
      aggregateContributors(
        { items: rawItems, entries: rawEntries, collaborators },
        displayNameById,
      ),
    [rawItems, rawEntries, collaborators, displayNameById],
  );

  const activity = useMemo(
    () =>
      aggregateActivity(
        { items: rawItems, entries: rawEntries },
        displayNameById,
      ),
    [rawItems, rawEntries, displayNameById],
  );

  return {
    session,
    collaborators,
    contributors,
    activity,
    lastPolledAt,
    loading,
    error,
    refresh,
  };
}
