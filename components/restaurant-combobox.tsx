"use client";

import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ResolvedPlace } from "@/lib/types";

interface Suggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
}

interface GeoPoint {
  lat: number;
  lng: number;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_CHARS = 3;
const MAX_AUTOCOMPLETE_CALLS_PER_TOKEN = 10;

interface RestaurantComboboxProps {
  /**
   * Controlled resolved-place value. The parent (e.g. the setup form) holds
   * this in local state before a session is started, and passes it into
   * `startSession({ ..., resolvedPlace })` at submit time. Mid-session
   * callers can bridge this to `useAyceStore.setResolvedPlace`.
   */
  resolvedPlace: ResolvedPlace | undefined;
  onResolvedPlaceChange: (place: ResolvedPlace | undefined) => void;
  /**
   * Free-text fallback name entered via the "enter manually" path. This is
   * the controlled value of the hidden manual input; the parent owns the
   * string so it can submit it when no place is resolved.
   */
  manualName: string;
  onManualNameChange: (value: string) => void;
  /** Called when the combobox starts or finishes resolving a place. */
  onResolvingChange?: (resolving: boolean) => void;
}

export function RestaurantCombobox({
  resolvedPlace,
  onResolvedPlaceChange,
  manualName,
  onManualNameChange,
  onResolvingChange,
}: RestaurantComboboxProps) {
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [manualMode, setManualMode] = React.useState(false);

  // Geolocation: ask once, cache the result, proceed without on deny/error.
  const [geoPoint, setGeoPoint] = React.useState<GeoPoint | null>(null);
  const [geoAsked, setGeoAsked] = React.useState(false);
  const [geoPrompt, setGeoPrompt] = React.useState<"idle" | "asking" | "done">(
    "idle",
  );

  // Session token lifecycle: one UUID per "typing session". Rotate after a
  // successful resolve so the next search starts a fresh billed session.
  // Also track per-token request count so a stuck client cannot burn the
  // Autocomplete Requests SKU even if debounce/min-length are bypassed.
  const sessionTokenRef = React.useRef<string>(crypto.randomUUID());
  const tokenRequestCountRef = React.useRef<number>(0);
  const rotateSessionToken = React.useCallback(() => {
    sessionTokenRef.current = crypto.randomUUID();
    tokenRequestCountRef.current = 0;
  }, []);

  // AbortController so a stale in-flight request never overwrites newer
  // results. Debounce timer ref so rapid typing doesn't queue up fetches.
  const abortRef = React.useRef<AbortController | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // If a place is already selected, don't autocomplete — show the confirmation
  // row instead. The debounced effect still runs but the early guard skips.
  React.useEffect(() => {
    if (resolvedPlace) {
      setItems([]);
      setErrorMessage(null);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_CHARS) {
      setItems([]);
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }
    if (tokenRequestCountRef.current >= MAX_AUTOCOMPLETE_CALLS_PER_TOKEN) {
      setErrorMessage(
        "Too many searches — pick a result or refine your query.",
      );
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runAutocomplete(trimmed);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, resolvedPlace, geoPoint]);

  async function runAutocomplete(trimmed: string) {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    tokenRequestCountRef.current += 1;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/places/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: trimmed,
          sessionToken: sessionTokenRef.current,
          bias: geoPoint
            ? { lat: geoPoint.lat, lng: geoPoint.lng, radius: 5000 }
            : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setItems([]);
        if (json.error === "rate_limited") {
          setErrorMessage("Slow down — too many searches. Try again in a moment.");
        } else if (json.error === "missing_api_key") {
          setErrorMessage("Restaurant search is not configured yet.");
        } else {
          setErrorMessage("Search failed. Try again.");
        }
        return;
      }

      const json = (await res.json()) as { suggestions: Suggestion[] };
      setItems(json.suggestions ?? []);
    } catch (err) {
      if ((err as { name?: string } | undefined)?.name === "AbortError") {
        return;
      }
      setItems([]);
      setErrorMessage("Search failed. Check your connection and try again.");
    } finally {
      if (abortRef.current === controller) {
        setIsLoading(false);
      }
    }
  }

  function handleAskForLocation() {
    if (geoAsked || typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoPrompt("done");
      setGeoAsked(true);
      return;
    }
    setGeoPrompt("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoPoint({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setGeoAsked(true);
        setGeoPrompt("done");
      },
      () => {
        setGeoAsked(true);
        setGeoPrompt("done");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }

  function handleDismissLocation() {
    setGeoAsked(true);
    setGeoPrompt("done");
  }

  async function handleSelect(suggestion: Suggestion) {
    setIsLoading(true);
    setErrorMessage(null);
    onResolvingChange?.(true);
    try {
      const res = await fetch("/api/places/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: suggestion.placeId }),
      });
      if (!res.ok) {
        setErrorMessage("Couldn't load that restaurant. Try another one.");
        return;
      }
      const json = (await res.json()) as { place: ResolvedPlace };
      onResolvedPlaceChange(json.place);
      onManualNameChange(""); // clear manual-mode state if any
      setManualMode(false);
      setQuery("");
      setItems([]);
      // Rotate session token so the next billable session starts fresh.
      rotateSessionToken();
    } catch {
      setErrorMessage("Couldn't load that restaurant. Try another one.");
    } finally {
      setIsLoading(false);
      onResolvingChange?.(false);
    }
  }

  function handleChange() {
    onResolvedPlaceChange(undefined);
    setQuery("");
    setItems([]);
    setErrorMessage(null);
    rotateSessionToken();
  }

  function handleEnterManually() {
    setManualMode(true);
    onResolvedPlaceChange(undefined);
    setItems([]);
    setErrorMessage(null);
    rotateSessionToken();
  }

  // -------------------------------------------------------------------------
  // Rendered states (in order): resolved → manual → combobox
  // -------------------------------------------------------------------------

  if (resolvedPlace) {
    return (
      <div
        className="flex flex-col gap-2"
        aria-live="polite"
        data-testid="restaurant-resolved"
      >
        <label className="text-sm font-medium tracking-[0.01em] text-[#191c1f] dark:text-white">
          Restaurant
        </label>
        <div className="flex items-start justify-between gap-4 rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white p-4 dark:border-white/10 dark:bg-[#191c1f]">
          <div className="min-w-0">
            <div className="truncate text-base font-medium text-[#191c1f] dark:text-white">
              {resolvedPlace.name}
            </div>
            <div className="mt-0.5 truncate text-sm text-[#505a63] dark:text-[#8d969e]">
              {resolvedPlace.formattedAddress}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleChange}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  if (manualMode) {
    return (
      <div className="flex flex-col gap-2">
        <label
          htmlFor="restaurant-name-manual"
          className="text-sm font-medium tracking-[0.01em] text-[#191c1f] dark:text-white"
        >
          Restaurant <span className="text-[#505a63] dark:text-[#8d969e]">(manual)</span>
        </label>
        <Input
          id="restaurant-name-manual"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="KBBQ Town"
          value={manualName}
          onChange={(e) => onManualNameChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setManualMode(false)}
          className="self-start text-xs font-medium text-[#191c1f] underline-offset-2 hover:underline dark:text-white"
        >
          Search for a restaurant instead
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="restaurant-combobox-input"
        className="text-sm font-medium tracking-[0.01em] text-[#191c1f] dark:text-white"
      >
        Restaurant <span className="text-[#505a63] dark:text-[#8d969e]">(optional)</span>
      </label>

      <Combobox.Root<Suggestion>
        items={items}
        inputValue={query}
        onInputValueChange={(value) => setQuery(value)}
        itemToStringLabel={(item) => item.primaryText}
        filter={null}
        onValueChange={(value) => {
          if (value && typeof value === "object" && "placeId" in value) {
            void handleSelect(value as Suggestion);
          }
        }}
      >
        <Combobox.Input
          id="restaurant-combobox-input"
          placeholder="Search for a restaurant…"
          className="h-12 w-full min-w-0 rounded-full border border-[rgba(25,28,31,0.12)] bg-white px-5 text-[0.9375rem] tracking-[0.01em] text-[#191c1f] outline-none transition-colors placeholder:text-[#8d969e] focus-visible:border-[#191c1f] dark:border-white/15 dark:bg-[#191c1f] dark:text-white dark:focus-visible:border-white"
        />
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={8} className="z-50 outline-none">
            <Combobox.Popup className="max-h-[320px] w-[var(--anchor-width)] overflow-auto rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#191c1f]">
              <Combobox.Empty className="px-4 py-3 text-sm text-[#505a63] dark:text-[#8d969e]">
                {query.trim().length < MIN_QUERY_CHARS
                  ? "Type at least 3 characters."
                  : isLoading
                    ? "Searching…"
                    : "No matches."}
              </Combobox.Empty>
              <Combobox.List>
                {(item: Suggestion) => (
                  <Combobox.Item
                    key={item.placeId}
                    value={item}
                    className="flex cursor-pointer flex-col gap-0.5 rounded-[14px] px-4 py-3 text-left outline-none data-[highlighted]:bg-[#f4f4f4] dark:data-[highlighted]:bg-[#262a2e]"
                  >
                    <span className="text-sm font-medium text-[#191c1f] dark:text-white">
                      {item.primaryText}
                    </span>
                    {item.secondaryText ? (
                      <span className="text-xs text-[#505a63] dark:text-[#8d969e]">
                        {item.secondaryText}
                      </span>
                    ) : null}
                  </Combobox.Item>
                )}
              </Combobox.List>
              <button
                type="button"
                onClick={handleEnterManually}
                className="mt-1 flex w-full flex-col gap-0.5 rounded-[14px] px-4 py-3 text-left text-sm text-[#191c1f] hover:bg-[#f4f4f4] dark:text-white dark:hover:bg-[#262a2e]"
              >
                None of these — enter manually
              </button>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      {geoPrompt === "idle" && !geoAsked ? (
        <div className="mt-1 flex items-center gap-3 rounded-[14px] border border-dashed border-[rgba(25,28,31,0.12)] px-3 py-2 text-xs text-[#505a63] dark:border-white/10 dark:text-[#8d969e]">
          <span>Use your location to find nearby restaurants?</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={handleAskForLocation}
              className="font-medium text-[#191c1f] underline-offset-2 hover:underline dark:text-white"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={handleDismissLocation}
              className="text-[#505a63] underline-offset-2 hover:underline dark:text-[#8d969e]"
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="text-sm text-[#e23b4a]">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
