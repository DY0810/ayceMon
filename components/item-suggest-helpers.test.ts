import { describe, expect, it } from "vitest";

import { applyPick, computeSource } from "./item-suggest-helpers";
import type { SeedEntry } from "@/lib/seed-catalog";

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
};

describe("applyPick", () => {
  it("maps a seed suggestion to form state", () => {
    const patch = applyPick({ kind: "seed", entry: sampleEntry }, "seed");
    expect(patch.name).toBe("Wagyu short rib");
    expect(patch.alaCarteValue).toBe("18");
    expect(patch.fillFactor).toBe(5);
    expect(patch.category).toBe("meat");
    expect(patch.sourceKind).toBe("seed");
    expect(patch.sourceRef).toBe("kbbq.wagyu-short-rib");
    expect(patch.pickedRefName).toBe("Wagyu short rib");
  });

  it("handles a seed entry without a category", () => {
    const noCategory: SeedEntry = { ...sampleEntry, category: undefined };
    const patch = applyPick({ kind: "seed", entry: noCategory }, "seed");
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
