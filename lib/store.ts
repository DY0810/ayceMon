"use client";
import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type { CityTier, EatenEntry, Item, ItemId, Session } from "./types";

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const browserStorage = (): StateStorage =>
  typeof window === "undefined" ? noopStorage : window.localStorage;

interface AyceStore {
  session: Session | null;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  startSession: (input: {
    restaurantName?: string;
    buffetPrice: number;
    appetiteBudget: number;
    cityTier?: CityTier;
  }) => void;
  endSession: () => void;
  addItemToLibrary: (item: Omit<Item, "id">) => void;
  removeItemFromLibrary: (id: ItemId) => void;
  logEaten: (itemId: ItemId, units: number) => void;
  clearEaten: () => void;
  finishMeal: () => void;
  resumeMeal: () => void;
}

export const useAyceStore = create<AyceStore>()(
  persist(
    (set) => ({
      session: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      startSession: ({
        restaurantName,
        buffetPrice,
        appetiteBudget,
        cityTier,
      }) =>
        set({
          session: {
            id: crypto.randomUUID(),
            restaurantName,
            buffetPrice,
            appetiteBudget,
            cityTier,
            library: [],
            eaten: [],
            startedAt: Date.now(),
          },
        }),
      endSession: () => set({ session: null }),
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
      logEaten: (itemId, units) =>
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
                    e.itemId === itemId ? { ...e, units: nextUnits } : e
                  );
          } else if (units > 0) {
            nextEaten = [...state.session.eaten, { itemId, units }];
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
        set((state) =>
          state.session
            ? { session: { ...state.session, finishedAt: Date.now() } }
            : state
        ),
      resumeMeal: () =>
        set((state) =>
          state.session
            ? { session: { ...state.session, finishedAt: undefined } }
            : state
        ),
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
