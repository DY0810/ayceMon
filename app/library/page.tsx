"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import {
  addSharedLibraryItem,
  removeSharedLibraryItem,
} from "@/app/actions/shared-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ItemSuggest } from "@/components/item-suggest";
import {
  applyPick,
  computeSource,
  type SuggestionEntry,
} from "@/components/item-suggest-helpers";
import { itemSource } from "@/lib/items";
import { adjustSeedRange, tierMultiplier } from "@/lib/pricing";
import { useAyceStore } from "@/lib/store";
import type { Item, ItemId, PriceSource } from "@/lib/types";
import { useSharedSession } from "@/lib/use-shared-session";

interface ItemFormErrors {
  name?: string;
  alaCarteValue?: string;
  gramsPerUnit?: string;
}

// Phase 2 (collab-and-quantitative-appetite): derive the legacy 1–10
// fillFactor from grams per unit so items persisted by pre-grams
// clients (and the Phase 3 tracker fallback) keep a sensible value.
// Rule: round(g / 30), clamped to [1, 10]. 30 g per fill-unit aligns
// with the author-picked anchors in PLAN.md (1 = single shrimp,
// 10 = whole pizza ≈ 800 g / 8 slices).
function deriveFillFactor(gramsPerUnit: number): number {
  if (!Number.isFinite(gramsPerUnit) || gramsPerUnit <= 0) return 1;
  return Math.min(10, Math.max(1, Math.round(gramsPerUnit / 30)));
}

export default function LibraryPage() {
  const router = useRouter();
  const soloSession = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);
  const soloAddItem = useAyceStore((state) => state.addItemToLibrary);
  const soloRemoveItem = useAyceStore(
    (state) => state.removeItemFromLibrary
  );
  const sharedSessionId = useAyceStore((state) => state.sharedSessionId);

  const shared = useSharedSession(sharedSessionId);
  const session = sharedSessionId ? shared.session : soloSession;
  // Same pattern as tracker — depend on the stable `refresh` function, not
  // the parent `shared` view object (which is rebuilt every render).
  const refreshShared = shared.refresh;

  const [mutationError, setMutationError] = useState<string | null>(null);

  const addItemToLibrary = useCallback(
    (item: Omit<Item, "id">) => {
      if (!sharedSessionId) {
        soloAddItem(item);
        return;
      }
      const withId: Item = { ...item, id: crypto.randomUUID() };
      setMutationError(null);
      void addSharedLibraryItem({ sessionId: sharedSessionId, item: withId })
        .then((result) => {
          if (!result.ok) {
            setMutationError("Could not add that item. Try again.");
            return;
          }
          return refreshShared();
        })
        .catch(() => setMutationError("Could not add that item. Try again."));
    },
    [sharedSessionId, soloAddItem, refreshShared],
  );

  const removeItemFromLibrary = useCallback(
    (id: ItemId) => {
      if (!sharedSessionId) {
        soloRemoveItem(id);
        return;
      }
      setMutationError(null);
      void removeSharedLibraryItem({ sessionId: sharedSessionId, itemId: id })
        .then((result) => {
          if (!result.ok) {
            setMutationError("Could not remove that item. Try again.");
            return;
          }
          return refreshShared();
        })
        .catch(() => setMutationError("Could not remove that item. Try again."));
    },
    [sharedSessionId, soloRemoveItem, refreshShared],
  );

  const cityTier = session?.cityTier;
  const priceMultiplier = tierMultiplier(cityTier);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [alaCarteValue, setAlaCarteValue] = useState("");
  const [gramsPerUnitInput, setGramsPerUnitInput] = useState("");
  const [gramsPlaceholder, setGramsPlaceholder] = useState<number | undefined>(
    undefined,
  );
  const [category, setCategory] = useState("");
  const [errors, setErrors] = useState<ItemFormErrors>({});
  const [pickedSource, setPickedSource] = useState<PriceSource>("user");
  const [pickedSourceRef, setPickedSourceRef] = useState<string | undefined>(
    undefined
  );
  const [pickedRefName, setPickedRefName] = useState<string | undefined>(
    undefined
  );
  const [seedRange, setSeedRange] = useState<
    { low: number; high: number } | undefined
  >(undefined);

  // Redirect guard: no session → /setup. Run after hydration to avoid
  // bouncing on the initial render before persisted state is loaded. In
  // shared mode we only redirect on an explicit "not_found" error from
  // the polling endpoint — relying on `!shared.loading` would race the
  // hydration→fetch transition (matches the tracker guard).
  useEffect(() => {
    if (!hasHydrated) return;
    if (sharedSessionId) {
      if (shared.error === "not_found") {
        router.replace("/setup");
      }
      return;
    }
    if (session === null) {
      router.replace("/setup");
    }
  }, [hasHydrated, session, sharedSessionId, shared.error, router]);

  const summary = useMemo(() => {
    const lib = session?.library ?? [];
    if (lib.length === 0) {
      return { totalItems: 0, totalValue: 0, bestRatio: null as null | { name: string; ratio: number } };
    }
    const totalItems = lib.length;
    const totalValue = lib.reduce((acc, item) => acc + item.alaCarteValue, 0);
    let bestRatio: { name: string; ratio: number } | null = null;
    for (const item of lib) {
      const denom = item.fillFactor > 0 ? item.fillFactor : 1;
      const ratio = item.alaCarteValue / denom;
      if (bestRatio === null || ratio > bestRatio.ratio) {
        bestRatio = { name: item.name, ratio };
      }
    }
    return { totalItems, totalValue, bestRatio };
  }, [session?.library]);

  if (!hasHydrated || session === null) {
    return null;
  }

  function resetForm() {
    setName("");
    setAlaCarteValue("");
    setGramsPerUnitInput("");
    setGramsPlaceholder(undefined);
    setCategory("");
    setErrors({});
    setPickedSource("user");
    setPickedSourceRef(undefined);
    setPickedRefName(undefined);
    setSeedRange(undefined);
  }

  function handleNameChange(next: string) {
    setName(next);
    const { sourceKind, clearRef } = computeSource(pickedRefName, next);
    if (clearRef) {
      setPickedSource("user");
      setPickedSourceRef(undefined);
      setPickedRefName(undefined);
      setSeedRange(undefined);
    } else {
      setPickedSource(sourceKind);
    }
  }

  function handlePick(suggestion: SuggestionEntry, source: PriceSource) {
    const patch = applyPick(suggestion, source, cityTier);
    setName(patch.name);
    setAlaCarteValue(patch.alaCarteValue);
    // Phase 2: pre-fill grams-per-unit from the seed. If the user
    // has not typed anything yet, also commit the value as the
    // active input. Otherwise surface it only as a placeholder hint
    // so their in-progress entry is not clobbered.
    if (patch.gramsPerUnit !== undefined) {
      setGramsPlaceholder(patch.gramsPerUnit);
      if (gramsPerUnitInput.trim() === "") {
        setGramsPerUnitInput(String(patch.gramsPerUnit));
      }
    } else {
      setGramsPlaceholder(undefined);
    }
    setCategory(patch.category);
    setPickedSource(patch.sourceKind);
    setPickedSourceRef(patch.sourceRef);
    setPickedRefName(patch.pickedRefName);
    if (suggestion.kind === "seed") {
      setSeedRange(
        adjustSeedRange(
          suggestion.entry.valueLow,
          suggestion.entry.valueHigh,
          cityTier
        )
      );
    } else {
      setSeedRange({ low: suggestion.low, high: suggestion.high });
    }
    setErrors({});
  }

  function handleValueChange(next: string) {
    setAlaCarteValue(next);
    // User typed over the value — hide the "typical $low–high" hint.
    setSeedRange(undefined);
  }

  function validate(): ItemFormErrors {
    const next: ItemFormErrors = {};
    if (name.trim() === "") {
      next.name = "Give it a name.";
    }
    const value = Number(alaCarteValue);
    if (alaCarteValue.trim() === "" || Number.isNaN(value)) {
      next.alaCarteValue = "Enter the à la carte value.";
    } else if (value < 0) {
      next.alaCarteValue = "Value can't be negative.";
    }
    const grams = Number(gramsPerUnitInput);
    if (gramsPerUnitInput.trim() === "" || Number.isNaN(grams)) {
      next.gramsPerUnit = "Enter grams per serving.";
    } else if (grams < 1 || grams > 1000) {
      next.gramsPerUnit = "Pick a number between 1 and 1000.";
    }
    return next;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const grams = Number(gramsPerUnitInput);
    addItemToLibrary({
      name: name.trim(),
      alaCarteValue: Number(alaCarteValue),
      // Phase 2: write both new grams field AND legacy fillFactor
      // (derived) so old-client fullness math keeps working.
      gramsPerUnit: grams,
      fillFactor: deriveFillFactor(grams),
      category: category.trim() || undefined,
      sourceKind: pickedSource,
      sourceRef: pickedSourceRef,
    });
    resetForm();
    setOpen(false);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 lg:px-8 lg:py-16">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[var(--font-display)] text-3xl font-medium leading-tight tracking-tight text-foreground lg:text-5xl">
            Library
          </h1>
          <p className="mt-2 text-sm tracking-[0.01em] text-muted-foreground">
            {session.restaurantName ?? "Unnamed restaurant"} · buffet $
            {session.buffetPrice}
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) resetForm();
          }}
        >
          <DialogTrigger render={<Button />}>
            Add item
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add an item</DialogTitle>
              <DialogDescription>
                Anything available at this buffet you might eat.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={handleSubmit}
              noValidate
              className="flex flex-col gap-5"
            >
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="item-name"
                  className="text-sm font-medium tracking-[0.01em] text-foreground"
                >
                  Name
                </label>
                <ItemSuggest
                  inputId="item-name"
                  value={name}
                  onChange={handleNameChange}
                  onPick={handlePick}
                  placeholder="Wagyu short rib"
                  ariaInvalid={errors.name ? true : undefined}
                  ariaDescribedBy={errors.name ? "item-name-error" : undefined}
                  multiplier={priceMultiplier}
                />
                {errors.name ? (
                  <p
                    id="item-name-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {errors.name}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="item-value"
                    className="text-sm font-medium tracking-[0.01em] text-foreground"
                  >
                    À la carte value (USD)
                  </label>
                  {seedRange ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      typical ${seedRange.low.toFixed(0)}–$
                      {seedRange.high.toFixed(0)}
                    </span>
                  ) : null}
                </div>
                <Input
                  id="item-value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="18"
                  value={alaCarteValue}
                  onChange={(e) => handleValueChange(e.target.value)}
                  onBlur={() => setErrors(validate())}
                  aria-invalid={errors.alaCarteValue ? true : undefined}
                  aria-describedby={
                    errors.alaCarteValue ? "item-value-error" : undefined
                  }
                  required
                />
                {errors.alaCarteValue ? (
                  <p
                    id="item-value-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {errors.alaCarteValue}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="item-grams"
                  className="text-sm font-medium tracking-[0.01em] text-foreground"
                >
                  Grams per unit
                </label>
                <div className="relative">
                  <Input
                    id="item-grams"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1000}
                    step={1}
                    placeholder={
                      gramsPlaceholder !== undefined
                        ? String(gramsPlaceholder)
                        : "150"
                    }
                    value={gramsPerUnitInput}
                    onChange={(e) => setGramsPerUnitInput(e.target.value)}
                    onBlur={() => setErrors(validate())}
                    aria-invalid={errors.gramsPerUnit ? true : undefined}
                    aria-describedby={
                      errors.gramsPerUnit
                        ? "item-grams-error"
                        : "item-grams-help"
                    }
                    className="pr-10"
                    required
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-5 flex items-center text-sm text-muted-foreground"
                  >
                    g
                  </span>
                </div>
                {errors.gramsPerUnit ? (
                  <p
                    id="item-grams-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {errors.gramsPerUnit}
                  </p>
                ) : (
                  <p
                    id="item-grams-help"
                    className="text-xs tracking-[0.01em] text-muted-foreground"
                  >
                    One serving unit in grams. E.g. one nigiri ≈ 20 g,
                    one pizza slice ≈ 120 g.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="item-category"
                  className="text-sm font-medium tracking-[0.01em] text-foreground"
                >
                  Category{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="item-category"
                  type="text"
                  autoComplete="off"
                  placeholder="meat, sushi, dessert…"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>

              <DialogFooter>
                <Button type="submit">
                  Add to library
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {mutationError ? (
        <p
          role="alert"
          className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {mutationError}
        </p>
      ) : null}

      {session.library.length > 0 && summary.bestRatio ? (
        <div className="mb-8 hidden gap-4 sm:grid sm:grid-cols-3">
          <Card size="sm">
            <CardContent>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Total items
              </div>
              <div className="mt-2 font-[var(--font-display)] text-3xl font-medium tabular-nums tracking-tight text-foreground">
                {summary.totalItems}
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Library value
              </div>
              <div className="mt-2 font-[var(--font-display)] text-3xl font-medium tabular-nums tracking-tight text-foreground">
                ${summary.totalValue.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Best $/fill ratio
              </div>
              <div className="mt-2 font-[var(--font-display)] text-2xl font-medium tabular-nums tracking-tight text-foreground">
                <span className="truncate">{summary.bestRatio.name}</span>
                <span className="ml-1 text-base font-normal text-muted-foreground">
                  ${summary.bestRatio.ratio.toFixed(2)}/fill
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {session.library.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-[20px] border border-dashed border-input bg-secondary px-6 py-16 text-center">
          <p className="font-medium text-foreground">No items yet</p>
          <p className="mt-2 text-sm tracking-[0.01em] text-muted-foreground">
            Tap “Add item” to start building your buffet menu.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {session.library.map((item) => (
            <li key={item.id}>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>{item.name}</CardTitle>
                  <CardAction>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => removeItemFromLibrary(item.id)}
                      className="text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Trash2 />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium tabular-nums text-foreground">
                    ${item.alaCarteValue.toFixed(2)}
                  </span>
                  <span aria-hidden className="text-muted-foreground">
                    ·
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {item.gramsPerUnit !== undefined
                      ? `${item.gramsPerUnit} g`
                      : `fill ${item.fillFactor}/10`}
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {itemSource(item) === "seed" ? (
                      <Badge
                        variant="outline"
                        title="Pre-filled from seed catalog"
                      >
                        typical
                      </Badge>
                    ) : null}
                    {itemSource(item) === "estimate" ? (
                      <Badge
                        variant="outline"
                        title="Pre-filled by LLM estimate"
                      >
                        estimated
                      </Badge>
                    ) : null}
                    {item.category ? (
                      <Badge variant="secondary">{item.category}</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
