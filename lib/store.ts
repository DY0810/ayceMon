"use client";
import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type {
  CityTier,
  EatenEntry,
  Item,
  ItemId,
  ResolvedPlace,
  Session,
} from "./types";

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const browserStorage = (): StateStorage =>
  typeof window === "undefined" ? noopStorage : window.localStorage;

interface AyceStore {
  session: Session | null;
  // Finished guest sessions waiting for guest→user migration (Phase 6).
  // Phase 1 just declares the field; `finishMeal()` does not push into it
  // yet. Populated by Phase 6.
  finishedSessions: Session[];
  // Phase 6 (collab-and-quantitative-appetite): when non-null, the active
  // session is a server-backed shared session. Tracker/library/result
  // branch on this to call the `shared-session` server actions instead of
  // mutating Zustand. Guests and solo signed-in sessions keep it null.
  sharedSessionId: string | null;
  setSharedSessionId: (id: string | null) => void;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  startSession: (input: {
    restaurantName?: string;
    buffetPrice: number;
    appetiteBudget: number;
    // Phase 1 (collab-and-quantitative-appetite): optional grams-based
    // budget. null = user opted out ("skip, I'll eyeball it").
    appetiteBudgetGrams?: number | null;
    cityTier?: CityTier;
    resolvedPlace?: ResolvedPlace;
  }) => void;
  endSession: () => void;
  // Phase 5 (restaurant combobox) writes here. Passing undefined clears it
  // so the "change" button on the combobox can reset without restarting
  // the whole session.
  setResolvedPlace: (place: ResolvedPlace | undefined) => void;
  addItemToLibrary: (item: Omit<Item, "id">) => void;
  removeItemFromLibrary: (id: ItemId) => void;
  // Phase 1: optional third `grams` parameter records a direct mass for
  // this entry, overriding units × item.gramsPerUnit in computeFullness.
  // Aggregation is asymmetric: `units` is ADDITIVE across repeated calls
  // on the same itemId, while `grams`, when provided, REPLACES the prior
  // value. Callers that mix-mode log the same item (unit bump + gram
  // weigh-in) must therefore treat the stored grams as "mass of the most
  // recently weighed portion", not "total mass across all units" — Phase
  // 3 UI should surface this so users do not conflate the two.
  logEaten: (itemId: ItemId, units: number, grams?: number) => void;
  clearEaten: () => void;
  finishMeal: () => void;
  resumeMeal: () => void;
  removeFinishedSession: (id: string) => void;
}

export const useAyceStore = create<AyceStore>()(
  persist(
    (set) => ({
      session: null,
      finishedSessions: [],
      sharedSessionId: null,
      setSharedSessionId: (id) => set({ sharedSessionId: id }),
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      startSession: ({
        restaurantName,
        buffetPrice,
        appetiteBudget,
        appetiteBudgetGrams,
        cityTier,
        resolvedPlace,
      }) =>
        set({
          session: {
            id: crypto.randomUUID(),
            restaurantName,
            buffetPrice,
            appetiteBudget,
            appetiteBudgetGrams,
            cityTier,
            resolvedPlace,
            library: [],
            eaten: [],
            startedAt: Date.now(),
          },
        }),
      endSession: () => set({ session: null, sharedSessionId: null }),
      setResolvedPlace: (place) =>
        set((state) =>
          state.session
            ? { session: { ...state.session, resolvedPlace: place } }
            : state,
        ),
      addItemToLibrary: (item) =>
        set((state) =>
          state.session
            ? {
                session: {
                  ...state.session,
                  library: [...state.session.library, { ...item, id: crypto.randomUUID() }],
                },
              }
            : state
        ),
      removeItemFromLibrary: (id) =>
        set((state) =>
          state.session
            ? {
                session: {
                  ...state.session,
                  library: state.session.library.filter((i) => i.id !== id),
                  eaten: state.session.eaten.filter((e) => e.itemId !== id),
                },
              }
            : state
        ),
      logEaten: (itemId, units, grams) =>
        set((state) => {
          if (!state.session) return state;
          const existing = state.session.eaten.find((e) => e.itemId === itemId);
          let nextEaten: EatenEntry[];
          if (existing) {
            const nextUnits = Math.max(0, existing.units + units);
            nextEaten =
              nextUnits === 0
                ? state.session.eaten.filter((e) => e.itemId !== itemId)
                : state.session.eaten.map((e) =>
                    e.itemId === itemId
                      ? grams === undefined
                        ? { ...e, units: nextUnits }
                        : { ...e, units: nextUnits, grams }
                      : e,
                  );
          } else if (units > 0 || grams !== undefined) {
            // Phase 3 (+g button): allow grams-only entries for new items.
            // When a user taps +g first (before any +1) the call arrives as
            // (itemId, 0, N); we persist `units: 0, grams: N` so
            // computeFullness can still sum the mass. The shared-session
            // path (logSharedEaten) already accepts units=0 entries, so
            // this keeps the dual-path semantically symmetric.
            const entry: EatenEntry =
              grams === undefined
                ? { itemId, units }
                : { itemId, units, grams };
            nextEaten = [...state.session.eaten, entry];
          } else {
            return state;
          }
          return { session: { ...state.session, eaten: nextEaten } };
        }),
      clearEaten: () =>
        set((state) =>
          state.session ? { session: { ...state.session, eaten: [] } } : state
        ),
      finishMeal: () =>
        set((state) => {
          if (!state.session) return state;
          const finished = { ...state.session, finishedAt: Date.now() };
          return {
            session: finished,
            // Deep-copy the finished session into finishedSessions so the
            // guest→user migration drains it into session_records on first
            // sign-in. Sessions without a resolvedPlace promote with
            // restaurant_id = null + restaurant_name fallback.
            finishedSessions: [
              ...state.finishedSessions,
              JSON.parse(JSON.stringify(finished)) as Session,
            ],
          };
        }),
      resumeMeal: () =>
        set((state) =>
          state.session
            ? { session: { ...state.session, finishedAt: undefined } }
            : state
        ),
      removeFinishedSession: (id) =>
        set((state) => ({
          finishedSessions: state.finishedSessions.filter((s) => s.id !== id),
        })),
    }),
    {
      name: "ayce-mon-storage",
      storage: createJSONStorage(browserStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
