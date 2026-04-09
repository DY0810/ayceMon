export type ItemId = string;

export type PriceSource = "user" | "seed" | "estimate";

export type CityTier =
  | "metro-premium"
  | "metro-standard"
  | "suburban"
  | "rural";

export interface Item {
  id: ItemId;
  name: string;
  alaCarteValue: number;
  fillFactor: number;
  category?: string;
  sourceKind?: PriceSource;
  sourceRef?: string;
}

export interface EatenEntry {
  itemId: ItemId;
  units: number;
}

export interface Session {
  id: string;
  restaurantName?: string;
  buffetPrice: number;
  appetiteBudget: number;
  library: Item[];
  eaten: EatenEntry[];
  startedAt: number;
  finishedAt?: number;
  cityTier?: CityTier;
}
