import { describe, expect, it } from "vitest";

import {
  SEED_CATALOG,
  findSeedMatches,
  type Cuisine,
  type SeedEntry,
} from "./seed-catalog";

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

const ALL_CUISINES: readonly Cuisine[] = [
  "kbbq",
  "sushi",
  "chinese",
  "dimsum",
  "hotpot",
  "brazilian",
  "indian",
  "pizza",
  "seafood",
  "dessert",
  "other",
];

describe("findSeedMatches", () => {
  it("returns [] for an empty query", () => {
    expect(findSeedMatches("", 5)).toEqual([]);
  });

  it("returns [] for a whitespace-only query", () => {
    expect(findSeedMatches("   ", 5)).toEqual([]);
  });

  it("returns [] when limit <= 0", () => {
    expect(findSeedMatches("sushi", 0)).toEqual([]);
    expect(findSeedMatches("sushi", -3)).toEqual([]);
  });

  it("includes the wagyu short rib entry when searching 'short rib'", () => {
    const results = findSeedMatches("short rib", 10);
    const hasWagyu = results.some(
      (entry) => entry.id === "kbbq.wagyu-short-rib"
    );
    expect(hasWagyu).toBe(true);
  });

  it("is case-insensitive", () => {
    const upper = findSeedMatches("SUSHI", 5);
    expect(upper.length).toBeGreaterThan(0);
    const mixed = findSeedMatches("SaLmOn NiGiRi", 5);
    const hasSalmonNigiri = mixed.some(
      (entry) => entry.id === "sushi.salmon-nigiri"
    );
    expect(hasSalmonNigiri).toBe(true);
  });

  it("matches on an alias", () => {
    // "cali roll" is a known alias for the California Roll entry; the
    // canonical display name is "California Roll".
    const results = findSeedMatches("cali roll", 5);
    const hasCaliforniaRoll = results.some(
      (entry) => entry.id === "sushi.california-roll"
    );
    expect(hasCaliforniaRoll).toBe(true);
  });

  it("matches an alias even when the canonical name differs", () => {
    // "xlb" is an alias for Xiao Long Bao.
    const results = findSeedMatches("xlb", 5);
    const hasXlb = results.some((entry) => entry.id === "dimsum.xiao-long-bao");
    expect(hasXlb).toBe(true);
  });

  it("normalizes diacritics so ASCII queries match accented entries", () => {
    // "crème brûlée" in the catalog should be findable via ASCII "creme brulee".
    const ascii = findSeedMatches("creme brulee", 5);
    const hasBrulee = ascii.some(
      (entry) => entry.id === "dessert.creme-brulee"
    );
    expect(hasBrulee).toBe(true);

    // And the reverse: querying with diacritics also matches.
    const accented = findSeedMatches("crème brûlée", 5);
    const hasBruleeAccented = accented.some(
      (entry) => entry.id === "dessert.creme-brulee"
    );
    expect(hasBruleeAccented).toBe(true);

    // And a different accented entry ("jalapeño popper").
    const jalapeno = findSeedMatches("jalapeno", 5);
    const hasJalapeno = jalapeno.some(
      (entry) => entry.id === "dessert.jalapeno-popper"
    );
    expect(hasJalapeno).toBe(true);
  });

  it("respects the limit parameter", () => {
    const results = findSeedMatches("chicken", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns results sorted by score (exact > starts-with > includes)", () => {
    // Query "kimchi" — the exact-name "Kimchi" entry should outrank the
    // starts-with "Kimchi Jjigae" entry.
    const results = findSeedMatches("kimchi", 5);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const firstIndex = results.findIndex((e) => e.id === "kbbq.kimchi");
    const stewIndex = results.findIndex((e) => e.id === "kbbq.kimchi-jjigae");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(stewIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(stewIndex);
  });

  it("returns [] when no entries match", () => {
    expect(findSeedMatches("zzzzzzznotafood", 5)).toEqual([]);
  });

  it("collapses internal whitespace runs in the query", () => {
    const collapsed = findSeedMatches("short    rib", 5);
    const hasWagyu = collapsed.some(
      (entry) => entry.id === "kbbq.wagyu-short-rib"
    );
    expect(hasWagyu).toBe(true);
  });
});

describe("SEED_CATALOG invariants", () => {
  it("has at least 200 entries", () => {
    expect(SEED_CATALOG.length).toBeGreaterThanOrEqual(200);
  });

  it("enforces per-entry invariants on every entry", () => {
    const seenIds = new Set<string>();
    for (const entry of SEED_CATALOG) {
      // id format
      expect(
        ID_PATTERN.test(entry.id),
        `id does not match pattern: ${entry.id}`
      ).toBe(true);

      // id uniqueness
      expect(seenIds.has(entry.id), `duplicate id: ${entry.id}`).toBe(false);
      seenIds.add(entry.id);

      // price bounds
      expect(entry.valueLow, `valueLow must be > 0: ${entry.id}`).toBeGreaterThan(0);
      expect(
        entry.valueLow,
        `valueLow must be <= typicalValue: ${entry.id}`
      ).toBeLessThanOrEqual(entry.typicalValue);
      expect(
        entry.typicalValue,
        `typicalValue must be <= valueHigh: ${entry.id}`
      ).toBeLessThanOrEqual(entry.valueHigh);

      // fillFactor: integer in [1, 10]
      expect(
        Number.isInteger(entry.fillFactor),
        `fillFactor must be integer: ${entry.id}`
      ).toBe(true);
      expect(
        entry.fillFactor,
        `fillFactor must be >= 1: ${entry.id}`
      ).toBeGreaterThanOrEqual(1);
      expect(
        entry.fillFactor,
        `fillFactor must be <= 10: ${entry.id}`
      ).toBeLessThanOrEqual(10);

      // aliases: all lowercase, no exact duplicate of lowercased name
      const lowerName = entry.name.toLowerCase();
      const aliasSet = new Set<string>();
      for (const alias of entry.aliases) {
        expect(
          alias,
          `alias must be lowercased: ${entry.id} -> "${alias}"`
        ).toBe(alias.toLowerCase());
        expect(
          alias === lowerName,
          `alias must not duplicate name.toLowerCase(): ${entry.id} -> "${alias}"`
        ).toBe(false);
        expect(
          aliasSet.has(alias),
          `duplicate alias on entry: ${entry.id} -> "${alias}"`
        ).toBe(false);
        aliasSet.add(alias);
      }

      // cuisine is a known value
      expect(
        ALL_CUISINES.includes(entry.cuisine),
        `unknown cuisine: ${entry.id} -> "${entry.cuisine}"`
      ).toBe(true);
    }
  });
});

describe("SEED_CATALOG coverage", () => {
  function countByCuisine(cuisine: Cuisine): number {
    return SEED_CATALOG.filter((e: SeedEntry) => e.cuisine === cuisine).length;
  }

  it("covers every cuisine except possibly 'other'", () => {
    for (const cuisine of ALL_CUISINES) {
      if (cuisine === "other") continue;
      expect(
        countByCuisine(cuisine),
        `cuisine ${cuisine} should have at least one entry`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("has at least 15 KBBQ entries", () => {
    expect(countByCuisine("kbbq")).toBeGreaterThanOrEqual(15);
  });

  it("has at least 25 sushi entries", () => {
    expect(countByCuisine("sushi")).toBeGreaterThanOrEqual(25);
  });
});
