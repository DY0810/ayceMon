"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, List, Utensils } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RestaurantCombobox } from "@/components/restaurant-combobox";
import { useAyceStore } from "@/lib/store";
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
  { icon: Utensils, label: "A rough appetite (fill units)" },
  { icon: List, label: "Items you plan to eat" },
] as const;

interface FormErrors {
  buffetPrice?: string;
  appetiteBudget?: string;
}

export default function SetupPage() {
  const router = useRouter();
  const startSession = useAyceStore((state) => state.startSession);

  const [resolvedPlace, setResolvedPlace] = useState<ResolvedPlace | undefined>(
    undefined,
  );
  const [manualName, setManualName] = useState("");
  const [buffetPrice, setBuffetPrice] = useState("");
  const [appetiteBudget, setAppetiteBudget] = useState("30");
  const [cityTier, setCityTier] = useState<CityTier>("metro-standard");
  const [errors, setErrors] = useState<FormErrors>({});
  const [resolving, setResolving] = useState(false);

  function validate(): FormErrors {
    const next: FormErrors = {};
    const price = Number(buffetPrice);
    if (buffetPrice.trim() === "" || Number.isNaN(price)) {
      next.buffetPrice = "Enter a buffet price.";
    } else if (price < 0) {
      next.buffetPrice = "Price can't be negative.";
    }
    const budget = Number(appetiteBudget);
    if (appetiteBudget.trim() === "" || Number.isNaN(budget)) {
      next.appetiteBudget = "Enter an appetite budget.";
    } else if (budget < 1 || budget > 100) {
      next.appetiteBudget = "Pick a number between 1 and 100.";
    }
    return next;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (resolving) return;
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const derivedName = resolvedPlace?.name ?? manualName.trim();
    startSession({
      restaurantName: derivedName || undefined,
      buffetPrice: Number(buffetPrice),
      appetiteBudget: Number(appetiteBudget),
      cityTier,
      resolvedPlace,
    });
    router.push("/library");
  }

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

            <div className="flex flex-col gap-2">
              <label
                htmlFor="appetite-budget"
                className="text-sm font-medium tracking-[0.01em] text-[#191c1f] dark:text-white"
              >
                Appetite budget
              </label>
              <Input
                id="appetite-budget"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                placeholder="30"
                value={appetiteBudget}
                onChange={(e) => setAppetiteBudget(e.target.value)}
                onBlur={() => setErrors(validate())}
                aria-invalid={errors.appetiteBudget ? true : undefined}
                aria-describedby={
                  errors.appetiteBudget
                    ? "appetite-budget-error"
                    : "appetite-budget-help"
                }
                required
              />
              {errors.appetiteBudget ? (
                <p
                  id="appetite-budget-error"
                  role="alert"
                  className="text-sm text-[#e23b4a]"
                >
                  {errors.appetiteBudget}
                </p>
              ) : (
                <p
                  id="appetite-budget-help"
                  className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]"
                >
                  Total fill units you can stomach. Higher = hungrier.
                </p>
              )}
            </div>

            <Button type="submit" size="lg" className="mt-2 w-full" disabled={resolving}>
              {resolving ? "Loading restaurant…" : "Start session"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
