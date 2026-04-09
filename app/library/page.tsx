"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

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
import { Slider } from "@/components/ui/slider";
import { ItemSuggest } from "@/components/item-suggest";
import {
  applyPick,
  computeSource,
  type SuggestionEntry,
} from "@/components/item-suggest-helpers";
import { itemSource } from "@/lib/items";
import { adjustSeedRange, tierMultiplier } from "@/lib/pricing";
import { useAyceStore } from "@/lib/store";
import type { PriceSource } from "@/lib/types";

interface ItemFormErrors {
  name?: string;
  alaCarteValue?: string;
}

export default function LibraryPage() {
  const router = useRouter();
  const session = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);
  const addItemToLibrary = useAyceStore((state) => state.addItemToLibrary);
  const removeItemFromLibrary = useAyceStore(
    (state) => state.removeItemFromLibrary
  );

  const cityTier = session?.cityTier;
  const priceMultiplier = tierMultiplier(cityTier);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [alaCarteValue, setAlaCarteValue] = useState("");
  const [fillFactor, setFillFactor] = useState(5);
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
  // bouncing on the initial render before persisted state is loaded.
  useEffect(() => {
    if (hasHydrated && session === null) {
      router.replace("/setup");
    }
  }, [hasHydrated, session, router]);

  const library = session?.library ?? [];

  const summary = useMemo(() => {
    if (library.length === 0) {
      return { totalItems: 0, totalValue: 0, bestRatio: null as null | { name: string; ratio: number } };
    }
    const totalItems = library.length;
    const totalValue = library.reduce((acc, item) => acc + item.alaCarteValue, 0);
    let bestRatio: { name: string; ratio: number } | null = null;
    for (const item of library) {
      const denom = item.fillFactor > 0 ? item.fillFactor : 1;
      const ratio = item.alaCarteValue / denom;
      if (bestRatio === null || ratio > bestRatio.ratio) {
        bestRatio = { name: item.name, ratio };
      }
    }
    return { totalItems, totalValue, bestRatio };
  }, [library]);

  if (!hasHydrated || session === null) {
    return null;
  }

  function resetForm() {
    setName("");
    setAlaCarteValue("");
    setFillFactor(5);
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
    setFillFactor(patch.fillFactor);
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
    return next;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    addItemToLibrary({
      name: name.trim(),
      alaCarteValue: Number(alaCarteValue),
      fillFactor,
      category: category.trim() || undefined,
      sourceKind: pickedSource,
      sourceRef: pickedSourceRef,
    });
    resetForm();
    setOpen(false);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight lg:text-3xl">
            Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
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
          <DialogTrigger render={<Button className="h-11 px-4 text-base" />}>
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
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="item-name"
                  className="text-sm font-medium text-foreground"
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

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="item-value"
                    className="text-sm font-medium text-foreground"
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
                  className="h-11 text-base"
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
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="item-fill"
                    className="text-sm font-medium text-foreground"
                  >
                    Fill factor
                  </label>
                  <span
                    className="text-sm font-medium tabular-nums text-foreground"
                    aria-live="polite"
                  >
                    {fillFactor} / 10
                  </span>
                </div>
                <Slider
                  id="item-fill"
                  min={1}
                  max={10}
                  step={1}
                  value={fillFactor}
                  onValueChange={(value) =>
                    setFillFactor(Array.isArray(value) ? value[0] : value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  How filling one unit is. 1 = a single shrimp, 10 = a whole
                  pizza.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="item-category"
                  className="text-sm font-medium text-foreground"
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
                  className="h-11 text-base"
                />
              </div>

              <DialogFooter>
                <Button type="submit" className="h-11 text-base">
                  Add to library
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {session.library.length > 0 && summary.bestRatio ? (
        <div className="mb-6 hidden gap-3 sm:grid sm:grid-cols-3">
          <Card size="sm">
            <CardContent>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Total items
              </div>
              <div className="mt-1 font-heading text-2xl font-semibold tabular-nums">
                {summary.totalItems}
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Library value
              </div>
              <div className="mt-1 font-heading text-2xl font-semibold tabular-nums">
                ${summary.totalValue.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Best $/fill ratio
              </div>
              <div className="mt-1 font-heading text-2xl font-semibold tabular-nums">
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
        <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 px-4 py-12 text-center">
          <p className="font-medium text-foreground">No items yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap “Add item” to start building your buffet menu.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {session.library.map((item) => (
            <li key={item.id}>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>{item.name}</CardTitle>
                  <CardAction>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => removeItemFromLibrary(item.id)}
                      className="size-11 text-muted-foreground hover:text-destructive"
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
                    fill {item.fillFactor}/10
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {itemSource(item) === "seed" ? (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        title="Pre-filled from seed catalog"
                      >
                        typical
                      </Badge>
                    ) : null}
                    {itemSource(item) === "estimate" ? (
                      <Badge
                        variant="outline"
                        className="text-xs"
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
