import { describe, expect, it } from "vitest";

import { applyPick, computeSource } from "./item-suggest-helpers";
import type { SeedEntry } from "../lib/seed-catalog";

const sampleEntry: SeedEntry = {
  id: "kbbq.wagyu-short-rib",
  name: "Wagyu short rib",
  aliases: ["short rib", "wagyu"],
  cuisine: "kbbq",
  category: "meat",
  typicalValue: 18,
  valueLow: 15,
  valueHigh: 22,
  fillFactor: 5,
  gramsPerUnit: 150,
};

describe("applyPick", () => {
  it("maps a seed suggestion to form state at the baseline tier", () => {
    const patch = applyPick(
      { kind: "seed", entry: sampleEntry },
      "seed",
      "metro-standard"
    );
    expect(patch.name).toBe("Wagyu short rib");
    expect(patch.alaCarteValue).toBe("18");
    expect(patch.fillFactor).toBe(5);
    expect(patch.category).toBe("meat");
    expect(patch.sourceKind).toBe("seed");
    expect(patch.sourceRef).toBe("kbbq.wagyu-short-rib");
    expect(patch.pickedRefName).toBe("Wagyu short rib");
    expect(patch.gramsPerUnit).toBe(150);
  });

  it("defaults to baseline when tier is omitted", () => {
    const patch = applyPick({ kind: "seed", entry: sampleEntry }, "seed");
    expect(patch.alaCarteValue).toBe("18");
  });

  it("adjusts the seed value up for metro-premium", () => {
    // 18 × 1.2 = 21.60 → nearest $0.25 = 21.50
    const patch = applyPick(
      { kind: "seed", entry: sampleEntry },
      "seed",
      "metro-premium"
    );
    expect(patch.alaCarteValue).toBe("21.5");
  });

  it("adjusts the seed value down for rural", () => {
    // 18 × 0.8 = 14.40 → nearest $0.25 = 14.50
    const patch = applyPick(
      { kind: "seed", entry: sampleEntry },
      "seed",
      "rural"
    );
    expect(patch.alaCarteValue).toBe("14.5");
  });

  it("does NOT adjust estimate suggestions by tier", () => {
    const patch = applyPick(
      { kind: "estimate", name: "Mystery dish", estimate: 12, low: 10, high: 14 },
      "estimate",
      "metro-premium"
    );
    expect(patch.alaCarteValue).toBe("12");
  });

  it("handles a seed entry without a category", () => {
    const noCategory: SeedEntry = { ...sampleEntry, category: undefined };
    const patch = applyPick(
      { kind: "seed", entry: noCategory },
      "seed",
      "metro-standard"
    );
    expect(patch.category).toBe("");
  });

  it("maps an estimate suggestion to form state", () => {
    const patch = applyPick(
      { kind: "estimate", name: "Mystery dish", estimate: 12, low: 10, high: 14 },
      "estimate"
    );
    expect(patch.name).toBe("Mystery dish");
    expect(patch.alaCarteValue).toBe("12");
    expect(patch.sourceKind).toBe("estimate");
    expect(patch.sourceRef).toBe("estimate.mystery dish");
    expect(patch.pickedRefName).toBe("Mystery dish");
    expect(patch.gramsPerUnit).toBeUndefined();
  });
});

describe("computeSource", () => {
  it("returns user when nothing was picked", () => {
    expect(computeSource(undefined, "anything")).toEqual({
      sourceKind: "user",
      clearRef: false,
    });
  });

  it("keeps seed when name equals picked ref", () => {
    expect(computeSource("Wagyu short rib", "Wagyu short rib")).toEqual({
      sourceKind: "seed",
      clearRef: false,
    });
  });

  it("tolerates whitespace differences around the picked name", () => {
    expect(computeSource("Wagyu short rib", "  Wagyu short rib  ")).toEqual({
      sourceKind: "seed",
      clearRef: false,
    });
  });

  it("clears ref when name is edited after pick", () => {
    expect(computeSource("Wagyu short rib", "Wagyu")).toEqual({
      sourceKind: "user",
      clearRef: true,
    });
  });

  it("clears ref when name is emptied after pick", () => {
    expect(computeSource("Wagyu short rib", "")).toEqual({
      sourceKind: "user",
      clearRef: true,
    });
  });
});
