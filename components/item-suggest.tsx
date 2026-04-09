"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";

import { Input } from "@/components/ui/input";
import { findSeedMatches, type SeedEntry } from "@/lib/seed-catalog";
import type { PriceSource } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  applyPick as _applyPick,
  type SuggestionEntry,
} from "./item-suggest-helpers";

// Suppress unused import warning: applyPick is part of the exported surface
// used by the caller's state patcher in app/library/page.tsx.
void _applyPick;

interface Props {
  value: string;
  onChange: (next: string) => void;
  onPick: (suggestion: SuggestionEntry, source: PriceSource) => void;
  inputId: string;
  placeholder?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  // Tier-adjusted price multiplier for the dropdown chip. Defaults to 1.0.
  multiplier?: number;
}

const MAX_SUGGESTIONS = 6;

const CUISINE_LABELS: Record<SeedEntry["cuisine"], string> = {
  kbbq: "KBBQ",
  sushi: "sushi",
  chinese: "Chinese",
  dimsum: "dim sum",
  hotpot: "hot pot",
  brazilian: "Brazilian",
  indian: "Indian",
  pizza: "pizza",
  seafood: "seafood",
  dessert: "dessert",
  other: "other",
};

// Multiply + round to nearest $0.25. Display-only; mirrors lib/pricing's
// internal rounding so the chip and the post-pick value line up exactly.
function adjustForDisplay(raw: number, multiplier: number): number {
  if (raw <= 0) return 0;
  return Math.round(raw * multiplier * 4) / 4;
}

export const ItemSuggest = forwardRef<HTMLInputElement, Props>(
  function ItemSuggest(
    {
      value,
      onChange,
      onPick,
      inputId,
      placeholder,
      ariaInvalid,
      ariaDescribedBy,
      multiplier = 1,
    },
    ref
  ) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const listboxId = useId();

    const matches = useMemo<readonly SeedEntry[]>(() => {
      if (value.trim() === "") return [];
      return findSeedMatches(value, MAX_SUGGESTIONS);
    }, [value]);

    // Reset active index whenever the match set changes.
    useEffect(() => {
      setActiveIndex(0);
    }, [matches]);

    // Close on click outside.
    useEffect(() => {
      if (!open) return;
      function handleDocumentMouseDown(e: MouseEvent) {
        const target = e.target as Node | null;
        if (wrapperRef.current && target && !wrapperRef.current.contains(target)) {
          setOpen(false);
        }
      }
      document.addEventListener("mousedown", handleDocumentMouseDown);
      return () => {
        document.removeEventListener("mousedown", handleDocumentMouseDown);
      };
    }, [open]);

    const showDropdown = open && matches.length > 0;

    const handleChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
        setOpen(true);
      },
      [onChange]
    );

    const handleFocus = useCallback(() => {
      setOpen(true);
    }, []);

    const pickEntry = useCallback(
      (entry: SeedEntry) => {
        onPick({ kind: "seed", entry }, "seed");
        setOpen(false);
      },
      [onPick]
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (!showDropdown) {
          if (e.key === "ArrowDown" && matches.length > 0) {
            e.preventDefault();
            setOpen(true);
          }
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % matches.length);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        } else if (e.key === "Enter") {
          const entry = matches[activeIndex];
          if (entry) {
            e.preventDefault();
            pickEntry(entry);
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
        }
      },
      [showDropdown, matches, activeIndex, pickEntry]
    );

    const activeOptionId = showDropdown
      ? `${listboxId}-opt-${activeIndex}`
      : undefined;

    return (
      <div ref={wrapperRef} className="relative">
        <Input
          ref={ref}
          id={inputId}
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-invalid={ariaInvalid ? true : undefined}
          aria-describedby={ariaDescribedBy}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className="h-11 text-base"
        />
        {showDropdown ? (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
          >
            {matches.map((entry, i) => {
              const isActive = i === activeIndex;
              return (
                <li
                  key={entry.id}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => {
                    // Prevent the input from losing focus before the click.
                    e.preventDefault();
                    pickEntry(entry);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-popover-foreground"
                  )}
                >
                  <span className="truncate font-medium">{entry.name}</span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                    ${adjustForDisplay(entry.valueLow, multiplier).toFixed(0)}–$
                    {adjustForDisplay(entry.valueHigh, multiplier).toFixed(0)}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {CUISINE_LABELS[entry.cuisine]}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    );
  }
);
