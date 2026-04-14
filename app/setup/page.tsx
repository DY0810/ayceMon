"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, List, Utensils } from "lucide-react";

import { createSharedSession } from "@/app/actions/shared-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RestaurantCombobox } from "@/components/restaurant-combobox";
import { useAyceStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { CityTier, ResolvedPlace } from "@/lib/types";

interface TierOption {
  readonly value: CityTier;
  readonly label: string;
}

const CITY_TIER_OPTIONS: readonly TierOption[] = [
  { value: "metro-premium", label: "Major metro — NYC/SF/LA (+20%)" },
  { value: "metro-standard", label: "Standard city (default)" },
  { value: "suburban", label: "Suburban (−10%)" },
  { value: "rural", label: "Rural / small town (−20%)" },
] as const;

interface Requirement {
  readonly icon: typeof DollarSign;
  readonly label: string;
}

const REQUIREMENTS: readonly Requirement[] = [
  { icon: DollarSign, label: "The buffet price" },
  { icon: Utensils, label: "A rough appetite (grams of food)" },
  { icon: List, label: "Items you plan to eat" },
] as const;

// Phase 2 (collab-and-quantitative-appetite): mass-budget presets are
// anchored to Geliebter 1988 gastric-capacity data. See
// docs/quantitative-appetite.md for provenance.
interface BudgetPreset {
  readonly value: number;
  readonly label: string;
  readonly subtitle: string;
}

const BUDGET_PRESETS: readonly BudgetPreset[] = [
  { value: 800, label: "Light", subtitle: "800 g" },
  { value: 1200, label: "Typical", subtitle: "1200 g" },
  { value: 1800, label: "Big", subtitle: "1800 g" },
  { value: 2500, label: "Competitive", subtitle: "2500 g" },
] as const;

const DEFAULT_PRESET = 1200;

// Legacy appetiteBudget (1–100 int). The DB still CHECKs the column is
// in [1, 100] (migration 0001), so every write sends a clamped value
// regardless of the grams path. Phase 2 of the plan forbids deriving
// this from grams — we always write the median (50) for back-compat.
const LEGACY_APPETITE_BUDGET_FALLBACK = 50;

type BudgetMode = "preset" | "custom" | "skipped";

// Phase 6: only signed-in users may start an invite (shared) session.
// Guests always get "solo" — the UI hides the toggle entirely for them.
type SessionMode = "solo" | "invite";

interface FormErrors {
  buffetPrice?: string;
  customBudgetGrams?: string;
  sharedSession?: string;
}

export default function SetupPage() {
  const router = useRouter();
  const startSession = useAyceStore((state) => state.startSession);
  const setSharedSessionId = useAyceStore((state) => state.setSharedSessionId);

  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | undefined>(
    undefined,
  );
  const [manualName, setManualName] = useState("");
  const [buffetPrice, setBuffetPrice] = useState("");
  const [budgetMode, setBudgetMode] = useState<BudgetMode>("preset");
  const [presetGrams, setPresetGrams] = useState<number>(DEFAULT_PRESET);
  const [customGrams, setCustomGrams] = useState("");
  const [cityTier, setCityTier] = useState<CityTier>("metro-standard");
  const [errors, setErrors] = useState<FormErrors>({});
  const [resolving, setResolving] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>("solo");
  const [submitting, setSubmitting] = useState(false);

  // Tri-state auth: null = still loading, false = guest, { id } = signed in.
  // Mirrors the pattern in app/tracker/page.tsx so the toggle only surfaces
  // to authenticated users (guests cannot create shared sessions —
  // createSharedSession redirects to /login).
  const [authUser, setAuthUser] = useState<{ id: string } | null | false>(null);
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setAuthUser(data.user ? { id: data.user.id } : false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, ses) => {
      setAuthUser(ses?.user ? { id: ses.user.id } : false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  function resolveBudgetGrams(): number | null {
    if (budgetMode === "skipped") return null;
    if (budgetMode === "custom") {
      const n = Number(customGrams);
      return Number.isFinite(n) ? n : Number.NaN;
    }
    return presetGrams;
  }

  function validate(): FormErrors {
    const next: FormErrors = {};
    const price = Number(buffetPrice);
    if (buffetPrice.trim() === "" || Number.isNaN(price)) {
      next.buffetPrice = "Enter a buffet price.";
    } else if (price < 0) {
      next.buffetPrice = "Price can't be negative.";
    }
    if (budgetMode === "custom") {
      const grams = Number(customGrams);
      if (customGrams.trim() === "" || Number.isNaN(grams)) {
        next.customBudgetGrams = "Enter grams of food you can eat.";
      } else if (grams < 50 || grams > 10000) {
        // Matches the 0004 migration CHECK range (50–10000 g).
        next.customBudgetGrams = "Pick a number between 50 and 10000.";
      }
    }
    return next;
  }

  function handlePresetClick(value: number) {
    setBudgetMode("preset");
    setPresetGrams(value);
    setCustomGrams("");
    setErrors((prev) => ({ ...prev, customBudgetGrams: undefined }));
  }

  function handleCustomChange(next: string) {
    setBudgetMode("custom");
    setCustomGrams(next);
  }

  function handleSkipToggle() {
    if (budgetMode === "skipped") {
      setBudgetMode("preset");
      setPresetGrams(DEFAULT_PRESET);
    } else {
      setBudgetMode("skipped");
      setCustomGrams("");
      setErrors((prev) => ({ ...prev, customBudgetGrams: undefined }));
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (resolving || submitting) return;
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const derivedName = resolvedPlace?.name ?? manualName.trim();
    const gramsValue = resolveBudgetGrams();

    // Shared-session path (authed + invite mode): create the server row,
    // stash its id in Zustand, then mirror the draft shape locally so
    // tracker/library can render while polling the server.
    if (sessionMode === "invite") {
      if (!authUser) {
        setErrors({ sharedSession: "Sign in to invite collaborators." });
        return;
      }
      setSubmitting(true);
      try {
        const result = await createSharedSession({
          buffetPrice: Number(buffetPrice),
          appetiteBudget: LEGACY_APPETITE_BUDGET_FALLBACK,
          appetiteBudgetGrams: gramsValue,
          cityTier,
          restaurantName: derivedName || null,
          startedAt: new Date().toISOString(),
        });
        if (!result.ok) {
          setErrors({ sharedSession: result.error });
          setSubmitting(false);
          return;
        }
        setSharedSessionId(result.data.id);
        startSession({
          restaurantName: derivedName || undefined,
          buffetPrice: Number(buffetPrice),
          appetiteBudget: LEGACY_APPETITE_BUDGET_FALLBACK,
          appetiteBudgetGrams: gramsValue,
          cityTier,
          resolvedPlace,
        });
        router.push(`/library?session=${result.data.id}`);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSharedSessionId(null);
    startSession({
      restaurantName: derivedName || undefined,
      buffetPrice: Number(buffetPrice),
      // Legacy column is still DB-CHECK'd to [1, 100]. Always write the
      // median — the plan forbids deriving this from grams.
      appetiteBudget: LEGACY_APPETITE_BUDGET_FALLBACK,
      appetiteBudgetGrams: gramsValue,
      cityTier,
      resolvedPlace,
    });
    router.push("/library");
  }

  const selectedGrams =
    budgetMode === "skipped"
      ? null
      : budgetMode === "custom"
        ? Number(customGrams) || null
        : presetGrams;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
      <div className="grid items-start gap-12 lg:grid-cols-[1fr_minmax(0,520px)] lg:gap-20">
        <section className="hidden lg:block">
          <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-[#191c1f] lg:text-6xl dark:text-white">
            Start a session
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
            Tell us what the buffet costs and how hungry you are. We&apos;ll
            use this to figure out what combos beat the price.
          </p>
          <ul className="mt-12 flex flex-col gap-5">
            {REQUIREMENTS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-4 text-sm text-[#505a63] dark:text-[#8d969e]"
              >
                <span className="inline-flex size-11 items-center justify-center rounded-full bg-[#f4f4f4] text-[#191c1f] dark:bg-[#262a2e] dark:text-white">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-base text-[#191c1f] dark:text-white">{label}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="lg:rounded-[20px] lg:border lg:border-[rgba(25,28,31,0.08)] lg:bg-white lg:p-10 dark:lg:border-white/10 dark:lg:bg-[#191c1f]">
          <div className="mb-8">
            <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-[#191c1f] lg:hidden dark:text-white">
              Start a session
            </h1>
            <p className="mt-2 text-base leading-relaxed tracking-[0.01em] text-[#505a63] lg:hidden dark:text-[#8d969e]">
              Tell us what the buffet costs and how hungry you are.
            </p>
            <h2 className="hidden font-[var(--font-display)] text-2xl font-medium tracking-tight text-[#191c1f] lg:block dark:text-white">
              Session details
            </h2>
            <p className="mt-2 hidden text-sm tracking-[0.01em] text-[#505a63] lg:block dark:text-[#8d969e]">
              All fields except restaurant name are required.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
            <RestaurantCombobox
              resolvedPlace={resolvedPlace}
              onResolvedPlaceChange={setResolvedPlace}
              manualName={manualName}
              onManualNameChange={setManualName}
              onResolvingChange={setResolving}
            />

            <div className="flex flex-col gap-2">
              <label
                htmlFor="buffet-price"
                className="text-sm font-medium tracking-[0.01em] text-[#191c1f] dark:text-white"
              >
                Buffet price (USD)
              </label>
              <Input
                id="buffet-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="35"
                value={buffetPrice}
                onChange={(e) => setBuffetPrice(e.target.value)}
                onBlur={() => setErrors(validate())}
                aria-invalid={errors.buffetPrice ? true : undefined}
                aria-describedby={
                  errors.buffetPrice ? "buffet-price-error" : "buffet-price-help"
                }
                required
              />
              {errors.buffetPrice ? (
                <p
                  id="buffet-price-error"
                  role="alert"
                  className="text-sm text-[#e23b4a]"
                >
                  {errors.buffetPrice}
                </p>
              ) : (
                <p id="buffet-price-help" className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                  What you paid to walk in.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="city-tier"
                className="text-sm font-medium tracking-[0.01em] text-[#191c1f] dark:text-white"
              >
                City tier
              </label>
              <select
                id="city-tier"
                value={cityTier}
                onChange={(e) => setCityTier(e.target.value as CityTier)}
                aria-describedby="city-tier-help"
                className="h-12 w-full rounded-full border border-[rgba(25,28,31,0.12)] bg-white px-5 text-[0.9375rem] tracking-[0.01em] text-[#191c1f] outline-none transition-colors focus-visible:border-[#191c1f] dark:bg-[#191c1f] dark:text-white dark:border-white/15 dark:focus-visible:border-white"
              >
                {CITY_TIER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p id="city-tier-help" className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                Adjusts suggested à la carte prices for your area. Manual entries are never adjusted.
              </p>
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium tracking-[0.01em] text-[#191c1f] dark:text-white">
                <span>Appetite budget</span>
                <button
                  type="button"
                  onClick={handleSkipToggle}
                  aria-pressed={budgetMode === "skipped"}
                  className="text-xs font-normal tracking-[0.01em] text-[#505a63] underline-offset-4 hover:underline aria-pressed:font-medium aria-pressed:text-[#191c1f] dark:text-[#8d969e] dark:aria-pressed:text-white"
                >
                  {budgetMode === "skipped"
                    ? "Pick a budget"
                    : "Skip, I'll eyeball it"}
                </button>
              </legend>

              <div
                role="group"
                aria-label="Preset grams budget"
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {BUDGET_PRESETS.map((preset) => {
                  const isSelected =
                    budgetMode === "preset" && presetGrams === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => handlePresetClick(preset.value)}
                      aria-pressed={isSelected}
                      disabled={budgetMode === "skipped"}
                      className="flex h-auto min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 py-2.5 text-center transition-colors border-[rgba(25,28,31,0.12)] bg-white text-[#191c1f] hover:bg-[#f4f4f4] aria-pressed:border-[#191c1f] aria-pressed:bg-[#191c1f] aria-pressed:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-[#262a2e] dark:aria-pressed:border-white dark:aria-pressed:bg-white dark:aria-pressed:text-[#191c1f]"
                    >
                      <span className="text-sm font-medium leading-tight">
                        {preset.label}
                      </span>
                      <span className="text-xs tabular-nums opacity-80">
                        {preset.subtitle}
                      </span>
                    </button>
                  );
                })}
              </div>

              {budgetMode === "skipped" ? (
                <p className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                  No budget target. We&apos;ll show grams consumed without a
                  denominator.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="custom-grams"
                      className="shrink-0 text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]"
                    >
                      Or custom
                    </label>
                    <div className="relative flex-1">
                      <Input
                        id="custom-grams"
                        type="number"
                        inputMode="numeric"
                        min={50}
                        max={10000}
                        step={50}
                        placeholder="e.g. 1500"
                        value={customGrams}
                        onChange={(e) => handleCustomChange(e.target.value)}
                        onBlur={() => setErrors(validate())}
                        aria-invalid={
                          errors.customBudgetGrams ? true : undefined
                        }
                        aria-describedby={
                          errors.customBudgetGrams
                            ? "custom-grams-error"
                            : "custom-grams-help"
                        }
                        className="pr-10"
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 right-5 flex items-center text-sm text-[#505a63] dark:text-[#8d969e]"
                      >
                        g
                      </span>
                    </div>
                  </div>
                  {errors.customBudgetGrams ? (
                    <p
                      id="custom-grams-error"
                      role="alert"
                      className="text-sm text-[#e23b4a]"
                    >
                      {errors.customBudgetGrams}
                    </p>
                  ) : (
                    <p
                      id="custom-grams-help"
                      className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]"
                    >
                      {selectedGrams === null
                        ? "Pick a preset or type your own in grams."
                        : `Target ${selectedGrams} g of food mass. Comfort ceiling, not a hard cap.`}
                    </p>
                  )}
                </>
              )}
            </fieldset>

            {authUser ? (
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-sm font-medium tracking-[0.01em] text-[#191c1f] dark:text-white">
                  Session mode
                </legend>
                <div
                  role="group"
                  aria-label="Session mode"
                  className="grid grid-cols-2 gap-2"
                >
                  {(
                    [
                      { value: "solo", label: "Solo", subtitle: "Just me" },
                      {
                        value: "invite",
                        label: "Invite friends",
                        subtitle: "Shared session",
                      },
                    ] as const
                  ).map((opt) => {
                    const isSelected = sessionMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSessionMode(opt.value)}
                        aria-pressed={isSelected}
                        className="flex h-auto min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 py-2.5 text-center transition-colors border-[rgba(25,28,31,0.12)] bg-white text-[#191c1f] hover:bg-[#f4f4f4] aria-pressed:border-[#191c1f] aria-pressed:bg-[#191c1f] aria-pressed:text-white dark:border-white/15 dark:bg-transparent dark:text-white dark:hover:bg-[#262a2e] dark:aria-pressed:border-white dark:aria-pressed:bg-white dark:aria-pressed:text-[#191c1f]"
                      >
                        <span className="text-sm font-medium leading-tight">
                          {opt.label}
                        </span>
                        <span className="text-xs opacity-80">
                          {opt.subtitle}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errors.sharedSession ? (
                  <p role="alert" className="text-sm text-[#e23b4a]">
                    {errors.sharedSession}
                  </p>
                ) : (
                  <p className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                    {sessionMode === "invite"
                      ? "We'll give you a link to share after you start."
                      : "Track just your meal."}
                  </p>
                )}
              </fieldset>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="mt-2 w-full"
              disabled={resolving || submitting}
            >
              {submitting
                ? "Starting session…"
                : resolving
                  ? "Loading restaurant…"
                  : "Start session"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
