"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, List, Utensils } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAyceStore } from "@/lib/store";

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

  const [restaurantName, setRestaurantName] = useState("");
  const [buffetPrice, setBuffetPrice] = useState("");
  const [appetiteBudget, setAppetiteBudget] = useState("30");
  const [errors, setErrors] = useState<FormErrors>({});

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
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    startSession({
      restaurantName: restaurantName.trim() || undefined,
      buffetPrice: Number(buffetPrice),
      appetiteBudget: Number(appetiteBudget),
    });
    router.push("/library");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8 lg:py-16">
      <div className="grid items-start gap-10 lg:grid-cols-[1fr_minmax(0,480px)] lg:gap-16">
        <section className="hidden lg:block">
          <h1 className="font-heading text-4xl font-semibold tracking-tight lg:text-5xl">
            Start a session
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Tell us what the buffet costs and how hungry you are. We&apos;ll
            use this to figure out what combos beat the price.
          </p>
          <ul className="mt-10 flex flex-col gap-4">
            {REQUIREMENTS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-3 text-sm text-muted-foreground"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="text-base text-foreground">{label}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="lg:rounded-xl lg:bg-card lg:p-8 lg:ring-1 lg:ring-foreground/10">
          <div className="mb-6 lg:mb-8">
            <h1 className="font-heading text-2xl font-semibold tracking-tight lg:hidden">
              Start a session
            </h1>
            <p className="mt-1 text-sm text-muted-foreground lg:hidden">
              Tell us what the buffet costs and how hungry you are.
            </p>
            <h2 className="hidden font-heading text-xl font-semibold tracking-tight lg:block">
              Session details
            </h2>
            <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
              All fields except restaurant name are required.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="restaurant-name"
                className="text-sm font-medium text-foreground"
              >
                Restaurant <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="restaurant-name"
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder="KBBQ Town"
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                className="h-11 text-base"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="buffet-price"
                className="text-sm font-medium text-foreground"
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
                className="h-11 text-base"
              />
              {errors.buffetPrice ? (
                <p
                  id="buffet-price-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {errors.buffetPrice}
                </p>
              ) : (
                <p id="buffet-price-help" className="text-xs text-muted-foreground">
                  What you paid to walk in.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="appetite-budget"
                className="text-sm font-medium text-foreground"
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
                className="h-11 text-base"
              />
              {errors.appetiteBudget ? (
                <p
                  id="appetite-budget-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {errors.appetiteBudget}
                </p>
              ) : (
                <p
                  id="appetite-budget-help"
                  className="text-xs text-muted-foreground"
                >
                  Total fill units you can stomach. Higher = hungrier.
                </p>
              )}
            </div>

            <Button type="submit" className="mt-2 h-11 text-base">
              Start session
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
