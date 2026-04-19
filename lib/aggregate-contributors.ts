import { shortUserId } from "./format";
import type { LiveContributor } from "./types";

// Single source of truth for the per-user aggregation shown by the live
// shared-session hook AND the `listContributors` server action. Pure
// function; no IO. Inputs mirror the DB column shapes (strings from numeric
// columns) because both the polling GET and the server action read straight
// from the same supabase queries.
//
// Invariant: `valueEaten` is always derived from `units × item.alaCarteValue`
// at read time. Never persist it — owners can edit item prices, and a
// stored value would drift. Same rule applies to `grams`, which follows the
// `entry.grams ?? units × gramsPerUnit ?? 0` fallback used everywhere else
// in the codebase (computeFullness, finalizeSharedSession).

export interface AggregateContributorsInput {
  items: ReadonlyArray<{
    id: string;
    ala_carte_value: string | number;
    grams_per_unit: string | number | null;
  }>;
  entries: ReadonlyArray<{
    user_id: string;
    item_id: string;
    units: string | number;
    grams: string | number | null;
    logged_at: string;
  }>;
  collaborators: ReadonlyArray<{
    user_id: string;
    role: string;
  }>;
}

function coerceRole(role: string): LiveContributor["role"] {
  return role === "owner" ? "owner" : "collaborator";
}

export function aggregateContributors(
  data: AggregateContributorsInput,
  displayNameById?: ReadonlyMap<string, string>,
): LiveContributor[] {
  const valueById = new Map<string, number>();
  const gpuById = new Map<string, number | undefined>();
  for (const item of data.items) {
    const v = Number(item.ala_carte_value);
    valueById.set(item.id, Number.isFinite(v) ? v : 0);
    if (item.grams_per_unit === null) {
      gpuById.set(item.id, undefined);
    } else {
      const g = Number(item.grams_per_unit);
      gpuById.set(item.id, Number.isFinite(g) ? g : undefined);
    }
  }

  const roleById = new Map<string, LiveContributor["role"]>();
  for (const c of data.collaborators) {
    roleById.set(c.user_id, coerceRole(c.role));
  }

  interface Totals {
    valueEaten: number;
    grams: number;
    unitCount: number;
    lastLoggedAt: string | null;
  }
  const acc = new Map<string, Totals>();
  // Seed with the collaborator roster so zero-entry users become zero rows
  // rather than being dropped. This is the client-side analogue of the
  // LEFT JOIN the server action runs.
  for (const c of data.collaborators) {
    acc.set(c.user_id, {
      valueEaten: 0,
      grams: 0,
      unitCount: 0,
      lastLoggedAt: null,
    });
  }

  for (const e of data.entries) {
    const units = Number(e.units);
    if (!Number.isFinite(units)) continue;

    // valueById only ever holds finite numbers (validated when populated),
    // so missing item_id → 0 is the only defensive case we need here.
    const unitValue = valueById.get(e.item_id) ?? 0;
    const value = units * unitValue;

    const directGrams = e.grams === null ? undefined : Number(e.grams);
    const gpu = gpuById.get(e.item_id);
    const grams =
      directGrams !== undefined && Number.isFinite(directGrams)
        ? directGrams
        : typeof gpu === "number" && Number.isFinite(gpu)
          ? units * gpu
          : 0;

    const current = acc.get(e.user_id) ?? {
      valueEaten: 0,
      grams: 0,
      unitCount: 0,
      lastLoggedAt: null,
    };
    current.valueEaten += value;
    current.grams += grams;
    current.unitCount += units;
    // ISO-8601 strings sort lexicographically the same as chronologically,
    // so a plain `>` is safe here.
    if (current.lastLoggedAt === null || e.logged_at > current.lastLoggedAt) {
      current.lastLoggedAt = e.logged_at;
    }
    acc.set(e.user_id, current);
  }

  const rows: LiveContributor[] = [];
  for (const [userId, totals] of acc) {
    rows.push({
      userId,
      displayName: displayNameById?.get(userId) ?? shortUserId(userId),
      role: roleById.get(userId) ?? "collaborator",
      valueEaten: totals.valueEaten,
      grams: totals.grams,
      unitCount: totals.unitCount,
      lastLoggedAt: totals.lastLoggedAt,
    });
  }
  rows.sort((a, b) => a.userId.localeCompare(b.userId));
  return rows;
}
