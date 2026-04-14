"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/require-user";
import { computeTotals } from "@/lib/calc";
import type { Database } from "@/lib/supabase/database.types";
import type {
  EatenEntry,
  Item,
  ResolvedPlace,
  SessionContributor,
  SharedSessionId,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Shared-session server actions (Phase 6 of
// plans/collab-and-quantitative-appetite.md).
//
// Every action runs against the AUTHENTICATED server client — RLS is the
// primary access control. We additionally validate every client-supplied
// primitive (type + range) because server actions are public endpoints
// (Appendix B invariant #2). We never trust a client-supplied user_id on
// writes — the RLS WITH CHECK and the action code both derive it from
// `auth.uid()` / `requireUser()`. See invariant #14.
//
// The only place the admin client is allowed is the canonical restaurant
// upsert (invariant #4). Shared-session writes go through the authenticated
// client; finalize reuses the already-resolved restaurant_id that was set
// at session creation, so no admin write is needed here.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEM_ID_LEN = 100;
const MAX_NAME_LEN = 200;
const MAX_CATEGORY_LEN = 80;
const MAX_SOURCE_REF_LEN = 200;
const MAX_GRAMS = 10000;
const MAX_ALA_CARTE = 100000;
const MAX_UNITS = 10000;
const MAX_FILL_FACTOR = 100;

type SharedSessionsInsert =
  Database["public"]["Tables"]["shared_sessions"]["Insert"];
type SharedSessionItemsInsert =
  Database["public"]["Tables"]["shared_session_items"]["Insert"];
type SharedSessionEntriesInsert =
  Database["public"]["Tables"]["shared_session_entries"]["Insert"];
type SessionRecordsInsert =
  Database["public"]["Tables"]["session_records"]["Insert"];

export interface CreateSharedSessionInput {
  buffetPrice: number;
  appetiteBudget: number | null;
  appetiteBudgetGrams?: number | null;
  cityTier?: string | null;
  restaurantName?: string | null;
  restaurantId?: string | null; // optional existing restaurants.id reference
  resolvedPlace?: ResolvedPlace | null;
  startedAt: string; // ISO
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isValidUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

// ---------------------------------------------------------------------------
// createSharedSession — owner creates a shared session and is seeded as the
// first collaborator (role = 'owner'). Returns the new session id.
// ---------------------------------------------------------------------------
export async function createSharedSession(
  input: CreateSharedSessionInput,
): Promise<ActionResult<{ id: SharedSessionId }>> {
  const { user, supabase } = await requireUser();

  if (
    !isFiniteNumber(input?.buffetPrice) ||
    input.buffetPrice < 0 ||
    input.buffetPrice > 10000 ||
    (input.appetiteBudget !== null &&
      (!Number.isInteger(input.appetiteBudget) ||
        input.appetiteBudget < 1 ||
        input.appetiteBudget > 100)) ||
    typeof input.startedAt !== "string" ||
    Number.isNaN(Date.parse(input.startedAt))
  ) {
    return { ok: false, error: "invalid_input" };
  }

  if (
    input.appetiteBudgetGrams !== undefined &&
    input.appetiteBudgetGrams !== null &&
    (!isFiniteNumber(input.appetiteBudgetGrams) ||
      input.appetiteBudgetGrams < 50 ||
      input.appetiteBudgetGrams > 10000)
  ) {
    return { ok: false, error: "invalid_input" };
  }

  if (
    input.restaurantName !== undefined &&
    input.restaurantName !== null &&
    (typeof input.restaurantName !== "string" ||
      input.restaurantName.length > 255)
  ) {
    return { ok: false, error: "invalid_input" };
  }

  if (
    input.restaurantId !== undefined &&
    input.restaurantId !== null &&
    !isValidUuid(input.restaurantId)
  ) {
    return { ok: false, error: "invalid_input" };
  }

  if (
    input.cityTier !== undefined &&
    input.cityTier !== null &&
    !["metro-premium", "metro-standard", "suburban", "rural"].includes(
      input.cityTier,
    )
  ) {
    return { ok: false, error: "invalid_input" };
  }

  // `resolvedPlace` is display-only jsonb: only `googlePlaceId` is ever
  // trusted server-side. We still validate shape + bound every field so
  // the row survives RLS without leaking untyped client data into jsonb.
  let resolvedPlaceRow: ResolvedPlace | null = null;
  if (input.resolvedPlace !== undefined && input.resolvedPlace !== null) {
    const rp = input.resolvedPlace;
    if (
      typeof rp !== "object" ||
      typeof rp.googlePlaceId !== "string" ||
      rp.googlePlaceId.length === 0 ||
      rp.googlePlaceId.length > 255 ||
      typeof rp.name !== "string" ||
      rp.name.length > 255 ||
      typeof rp.formattedAddress !== "string" ||
      rp.formattedAddress.length > 500 ||
      !isFiniteNumber(rp.lat) ||
      rp.lat < -90 ||
      rp.lat > 90 ||
      !isFiniteNumber(rp.lng) ||
      rp.lng < -180 ||
      rp.lng > 180
    ) {
      return { ok: false, error: "invalid_input" };
    }
    resolvedPlaceRow = {
      googlePlaceId: rp.googlePlaceId,
      name: rp.name,
      formattedAddress: rp.formattedAddress,
      lat: rp.lat,
      lng: rp.lng,
    };
  }

  const sessionRow: SharedSessionsInsert = {
    owner_user_id: user.id,
    restaurant_id: input.restaurantId ?? null,
    restaurant_name: input.restaurantName ?? null,
    buffet_price: input.buffetPrice,
    appetite_budget: input.appetiteBudget,
    appetite_budget_grams: input.appetiteBudgetGrams ?? null,
    city_tier: input.cityTier ?? null,
    resolved_place:
      resolvedPlaceRow === null
        ? null
        : // supabase-js auto-serializes jsonb; do NOT JSON.stringify (invariant #8).
          (resolvedPlaceRow as unknown as SharedSessionsInsert["resolved_place"]),
    started_at: input.startedAt,
  };

  const { data: session, error: sessionError } = await supabase
    .from("shared_sessions")
    .insert(sessionRow)
    .select("id")
    .single();

  if (sessionError || !session) {
    return { ok: false, error: "session_insert_failed" };
  }

  // Owner row. RLS on shared_session_collaborators requires the caller to
  // be the owner of the session to insert — the just-created row satisfies
  // that.
  const { error: collabError } = await supabase
    .from("shared_session_collaborators")
    .insert({
      session_id: session.id,
      user_id: user.id,
      role: "owner",
    });

  if (collabError) {
    // Roll back the session so we don't leave an orphan. RLS lets the
    // owner delete their own session.
    await supabase.from("shared_sessions").delete().eq("id", session.id);
    return { ok: false, error: "collaborator_insert_failed" };
  }

  return { ok: true, data: { id: session.id } };
}

// ---------------------------------------------------------------------------
// addSharedLibraryItem — owner-only. Adds/overwrites a library entry.
// ---------------------------------------------------------------------------
export interface AddSharedLibraryItemInput {
  sessionId: SharedSessionId;
  item: Item;
}

export async function addSharedLibraryItem(
  input: AddSharedLibraryItemInput,
): Promise<ActionResult<{ ok: true }>> {
  const { supabase } = await requireUser();

  if (!isValidUuid(input?.sessionId)) {
    return { ok: false, error: "invalid_input" };
  }

  const item = input.item;
  if (
    typeof item?.id !== "string" ||
    item.id.length === 0 ||
    item.id.length > MAX_ITEM_ID_LEN ||
    typeof item?.name !== "string" ||
    item.name.length === 0 ||
    item.name.length > MAX_NAME_LEN ||
    !isFiniteNumber(item?.alaCarteValue) ||
    item.alaCarteValue < 0 ||
    item.alaCarteValue > MAX_ALA_CARTE ||
    !isFiniteNumber(item?.fillFactor) ||
    item.fillFactor < 0 ||
    item.fillFactor > MAX_FILL_FACTOR ||
    (item.gramsPerUnit !== undefined &&
      (!isFiniteNumber(item.gramsPerUnit) ||
        item.gramsPerUnit < 0 ||
        item.gramsPerUnit > MAX_GRAMS)) ||
    (item.category !== undefined &&
      (typeof item.category !== "string" ||
        item.category.length > MAX_CATEGORY_LEN)) ||
    (item.sourceKind !== undefined &&
      !["user", "seed", "estimate"].includes(item.sourceKind)) ||
    (item.sourceRef !== undefined &&
      (typeof item.sourceRef !== "string" ||
        item.sourceRef.length > MAX_SOURCE_REF_LEN))
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const row: SharedSessionItemsInsert = {
    session_id: input.sessionId,
    id: item.id,
    name: item.name,
    ala_carte_value: item.alaCarteValue,
    fill_factor: item.fillFactor,
    grams_per_unit: item.gramsPerUnit ?? null,
    category: item.category ?? null,
    source_kind: item.sourceKind ?? null,
    source_ref: item.sourceRef ?? null,
  };

  const { error } = await supabase
    .from("shared_session_items")
    .upsert(row, { onConflict: "session_id,id" });

  if (error) {
    return { ok: false, error: "item_insert_failed" };
  }

  revalidatePath(`/tracker?session=${input.sessionId}`);
  revalidatePath(`/library?session=${input.sessionId}`);
  return { ok: true, data: { ok: true } };
}

// ---------------------------------------------------------------------------
// removeSharedLibraryItem — owner-only. Cascades to entries via FK.
// ---------------------------------------------------------------------------
export interface RemoveSharedLibraryItemInput {
  sessionId: SharedSessionId;
  itemId: string;
}

export async function removeSharedLibraryItem(
  input: RemoveSharedLibraryItemInput,
): Promise<ActionResult<{ ok: true }>> {
  const { supabase } = await requireUser();

  if (
    !isValidUuid(input?.sessionId) ||
    typeof input?.itemId !== "string" ||
    input.itemId.length === 0 ||
    input.itemId.length > MAX_ITEM_ID_LEN
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const { error } = await supabase
    .from("shared_session_items")
    .delete()
    .eq("session_id", input.sessionId)
    .eq("id", input.itemId);

  if (error) {
    return { ok: false, error: "item_delete_failed" };
  }

  revalidatePath(`/tracker?session=${input.sessionId}`);
  revalidatePath(`/library?session=${input.sessionId}`);
  return { ok: true, data: { ok: true } };
}

// ---------------------------------------------------------------------------
// logSharedEaten — any collaborator. Inserts an entry for the calling user.
// ---------------------------------------------------------------------------
export interface LogSharedEatenInput {
  sessionId: SharedSessionId;
  itemId: string;
  units: number;
  grams?: number | null;
}

export async function logSharedEaten(
  input: LogSharedEatenInput,
): Promise<ActionResult<{ id: string }>> {
  const { user, supabase } = await requireUser();

  if (
    !isValidUuid(input?.sessionId) ||
    typeof input?.itemId !== "string" ||
    input.itemId.length === 0 ||
    input.itemId.length > MAX_ITEM_ID_LEN ||
    !isFiniteNumber(input?.units) ||
    input.units < 0 ||
    input.units > MAX_UNITS ||
    (input.grams !== undefined &&
      input.grams !== null &&
      (!isFiniteNumber(input.grams) ||
        input.grams < 0 ||
        input.grams > MAX_GRAMS))
  ) {
    return { ok: false, error: "invalid_input" };
  }

  const row: SharedSessionEntriesInsert = {
    session_id: input.sessionId,
    user_id: user.id, // invariant #14 — server-derived, never client-supplied
    item_id: input.itemId,
    units: input.units,
    grams: input.grams ?? null,
  };

  const { data: inserted, error } = await supabase
    .from("shared_session_entries")
    .insert(row)
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: "entry_insert_failed" };
  }

  revalidatePath(`/tracker?session=${input.sessionId}`);
  revalidatePath(`/result?session=${input.sessionId}`);
  return { ok: true, data: { id: inserted.id } };
}

// ---------------------------------------------------------------------------
// finalizeSharedSession — owner-only. Aggregates all entries into a single
// `session_records` row. Idempotent via the
// (user_id, client_session_id = shared_session.id) unique index: a retry
// hits the existing row and returns its id without duplicating.
// ---------------------------------------------------------------------------
export interface FinalizeSharedSessionInput {
  sessionId: SharedSessionId;
}

export async function finalizeSharedSession(
  input: FinalizeSharedSessionInput,
): Promise<ActionResult<{ id: string }>> {
  const { user, supabase } = await requireUser();

  if (!isValidUuid(input?.sessionId)) {
    return { ok: false, error: "invalid_input" };
  }

  // Fetch the session. RLS limits this to rows the caller can read (owner
  // or collaborator). We enforce owner-only below so only the owner can
  // finalize — collaborators cannot close someone else's session.
  const { data: session, error: sessionError } = await supabase
    .from("shared_sessions")
    .select(
      "id, owner_user_id, restaurant_id, restaurant_name, buffet_price, appetite_budget, appetite_budget_grams, started_at, finished_at",
    )
    .eq("id", input.sessionId)
    .maybeSingle();

  if (sessionError) {
    return { ok: false, error: "session_lookup_failed" };
  }
  if (!session) {
    return { ok: false, error: "not_found" };
  }
  if (session.owner_user_id !== user.id) {
    return { ok: false, error: "not_owner" };
  }

  // The legacy DB CHECK on session_records.appetite_budget enforces a 1–100
  // range AND NOT NULL. Shared sessions allow null. Fall back to 50 (median)
  // per the plan's setup-page rule, so a null-budget shared session still
  // persists into a valid session_records row.
  const appetiteBudgetInt =
    typeof session.appetite_budget === "number"
      ? Math.max(1, Math.min(100, Math.round(session.appetite_budget)))
      : 50;

  // Load items and entries. RLS ensures we only get rows for this session.
  const [itemsRes, entriesRes] = await Promise.all([
    supabase
      .from("shared_session_items")
      .select(
        "id, name, ala_carte_value, fill_factor, grams_per_unit, category, source_kind, source_ref",
      )
      .eq("session_id", session.id),
    supabase
      .from("shared_session_entries")
      .select("user_id, item_id, units, grams")
      .eq("session_id", session.id),
  ]);

  if (itemsRes.error || !itemsRes.data) {
    return { ok: false, error: "items_lookup_failed" };
  }
  if (entriesRes.error || !entriesRes.data) {
    return { ok: false, error: "entries_lookup_failed" };
  }

  const library: Item[] = itemsRes.data.map((r) => ({
    id: r.id,
    name: r.name,
    alaCarteValue: Number(r.ala_carte_value),
    fillFactor: Number(r.fill_factor),
    gramsPerUnit:
      r.grams_per_unit === null ? undefined : Number(r.grams_per_unit),
    category: r.category ?? undefined,
    sourceKind:
      r.source_kind === "user" ||
      r.source_kind === "seed" ||
      r.source_kind === "estimate"
        ? r.source_kind
        : undefined,
    sourceRef: r.source_ref ?? undefined,
  }));

  const eaten: EatenEntry[] = entriesRes.data.map((e) => ({
    itemId: e.item_id,
    units: Number(e.units),
    grams: e.grams === null ? undefined : Number(e.grams),
  }));

  const { total, margin, won } = computeTotals(
    library,
    eaten,
    Number(session.buffet_price),
  );

  // Per-user attribution. Resolve each entry to the contributor whose
  // user_id it belongs to; compute their totals using the same gram-fallback
  // rule as computeFullness (entry.grams || entry.units * item.gramsPerUnit).
  const gpuById = new Map(
    library.map((i) => [i.id, i.gramsPerUnit ?? undefined]),
  );
  const valueById = new Map(library.map((i) => [i.id, i.alaCarteValue]));
  const attributionByUser = new Map<string, SessionContributor>();

  for (const e of entriesRes.data) {
    const current: SessionContributor =
      attributionByUser.get(e.user_id) ?? {
        userId: e.user_id,
        units: 0,
        grams: 0,
        valueEaten: 0,
      };
    const units = Number(e.units);
    const gramsDirect = e.grams === null ? undefined : Number(e.grams);
    const gpu = gpuById.get(e.item_id);
    const grams =
      gramsDirect !== undefined && Number.isFinite(gramsDirect)
        ? gramsDirect
        : typeof gpu === "number" && Number.isFinite(gpu)
          ? units * gpu
          : 0;
    const unitValue = valueById.get(e.item_id);
    const value =
      typeof unitValue === "number" && Number.isFinite(unitValue)
        ? units * unitValue
        : 0;
    current.units += units;
    current.grams += grams;
    current.valueEaten += value;
    attributionByUser.set(e.user_id, current);
  }

  const contributors: SessionContributor[] = Array.from(
    attributionByUser.values(),
  ).sort((a, b) => a.userId.localeCompare(b.userId));

  // Idempotency: client_session_id = shared_session.id. A retry upserts
  // into the same row via the (user_id, client_session_id) unique index
  // from 0001_init.sql. finished_at is preserved on retry so the original
  // timestamp wins.
  const finishedAt = session.finished_at ?? new Date().toISOString();

  const recordRow: SessionRecordsInsert = {
    user_id: user.id, // owner's user_id
    restaurant_id: session.restaurant_id,
    restaurant_name: session.restaurant_name,
    client_session_id: session.id, // reuse shared_session.id as the idempotency key
    buffet_price: Number(session.buffet_price),
    appetite_budget: appetiteBudgetInt,
    appetite_budget_grams: session.appetite_budget_grams,
    // supabase-js serializes jsonb; do NOT JSON.stringify (invariant #8).
    library: library as unknown as SessionRecordsInsert["library"],
    eaten: eaten as unknown as SessionRecordsInsert["eaten"],
    contributors: contributors as unknown as SessionRecordsInsert["contributors"],
    total_eaten_value: total,
    margin,
    won,
    started_at: session.started_at,
    finished_at: finishedAt,
  };

  const { data: record, error: recordError } = await supabase
    .from("session_records")
    .upsert(recordRow, {
      onConflict: "user_id,client_session_id",
      ignoreDuplicates: false,
    })
    .select("id")
    .single();

  if (recordError || !record) {
    return { ok: false, error: "session_record_insert_failed" };
  }

  // Only stamp finished_at on the shared session the first time. If it
  // was already set (idempotent retry), leave the original timestamp so
  // subsequent finalizes don't move it.
  if (!session.finished_at) {
    const { error: finishErr } = await supabase
      .from("shared_sessions")
      .update({ finished_at: finishedAt })
      .eq("id", session.id);
    if (finishErr) {
      // Non-fatal: the session_records row is already written.
      // Log-worthy in a real observability pass; for now just surface
      // the id so the caller can redirect.
    }
  }

  revalidatePath("/history");
  revalidatePath(`/history/${record.id}`);
  revalidatePath("/stats");
  revalidatePath(`/result?session=${session.id}`);

  return { ok: true, data: { id: record.id } };
}
