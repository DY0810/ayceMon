import type { Item, PriceSource } from "./types";

export function itemSource(item: Item): PriceSource {
  return item.sourceKind ?? "user";
}
