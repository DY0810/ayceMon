"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/require-user";
import { computeTotals } from "@/lib/calc";
import { fetchPlaceDetails, PlacesApiError } from "@/lib/places/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { EatenEntry, Item } from "@/lib/types";

// Server action input. The ONLY field the server trusts from the client is
// `googlePlaceId` — everything about the restaurant (name/address/lat/lng) is
// re-fetched server-side via Places Details before the upsert. Accepting the
// client's name/address here would let any signed-in user pollute the shared
// `restaurants` table. See plans/user-auth-history-places.md Phase 3 trust
// boundary notes and Appendix B #5.
export interface FinishAndSaveInput {
  clientSessionId: string; // draft Session.id from Zustand — idempotency key
  googlePlaceId?: string; // only trusted client field; omitted for manual-name sessions
  restaurantName?: string; // display-only fallback when no Google Place is resolved
  buffetPrice: number;
  appetiteBudget: number;
  // Phase 1 (collab-and-quantitative-appetite): grams-based budget.
  // `null` = user opted out of a budget; `undefined` = legacy pre-grams
  // client that hasn't started sending the field yet.
  appetiteBudgetGrams?: number | null;
  library: Item[];
  eaten: EatenEntry[];
  startedAt: string; // ISO 8601
}

export type FinishAndSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Columns a JSON-serialisable snapshot must round-trip through. We pin the
// types to the generated database row so supabase-js doesn't widen them.
type SessionRecordsInsert = Database["public"]["Tables"]["session_records"]["Insert"];
type RestaurantsInsert = Database["public"]["Tables"]["restaurants"]["Insert"];

export async function finishAndSaveSession(
  input: FinishAndSaveInput,
): Promise<FinishAndSaveResult> {
  // Step 1 — require an authenticated user. `requireUser` redirects to
  // /login if there is no session; anything past this line runs with a
  // guaranteed non-null user.
  const { user, supabase } = await requireUser();

  // Step 2 — narrow client-supplied primitives defensively. A server action
  // is still a public endpoint and the caller may be a malicious client that
  // bypasses the TS type by calling fetch() directly.
  const hasPlaceId =
    typeof input?.googlePlaceId === "string" && input.googlePlaceId.length > 0;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    typeof input?.clientSessionId !== "string" ||
    !UUID_RE.test(input.clientSessionId) ||
    typeof input?.buffetPrice !== "number" ||
    !Number.isFinite(input.buffetPrice) ||
    input.buffetPrice < 0 ||
    typeof input?.appetiteBudget !== "number" ||
    !Number.isInteger(input.appetiteBudget) ||
    input.appetiteBudget < 1 ||
    input.appetiteBudget > 100 ||
    !Array.isArray(input?.library) ||
    input.library.length > 500 ||
    !Array.isArray(input?.eaten) ||
    input.eaten.length > 500 ||
    typeof input?.startedAt !== "string" ||
    Number.isNaN(Date.parse(input.startedAt))
  ) {
    return { ok: false, error: "invalid_input" };
  }

  // Phase 1: appetiteBudgetGrams is optional; when present it must be null
  // or a finite number matching the DB CHECK (50–10000). Mirrors the range
  // in supabase/migrations/0004_quantitative_appetite.sql.
  if (
    input.appetiteBudgetGrams !== undefined &&
    input.appetiteBudgetGrams !== null &&
    (typeof input.appetiteBudgetGrams !== "number" ||
      !Number.isFinite(input.appetiteBudgetGrams) ||
      input.appetiteBudgetGrams < 50 ||
      input.appetiteBudgetGrams > 10000)
  ) {
    return { ok: false, error: "invalid_input" };
  }

  // Per-element validation — a server action is a public endpoint.
  for (const item of input.library) {
    if (
      typeof item?.id !== "string" || item.id.length > 100 ||
      typeof item?.name !== "string" || item.name.length > 200 ||
      typeof item?.alaCarteValue !== "number" || !Number.isFinite(item.alaCarteValue) || item.alaCarteValue < 0 ||
      typeof item?.fillFactor !== "number" || !Number.isFinite(item.fillFactor) || item.fillFactor < 0 ||
      // Phase 1: gramsPerUnit is optional. When present it must be a
      // finite, non-negative number, and not larger than the session
      // budget ceiling (10000g, mirrors the DB CHECK range).
      (item.gramsPerUnit !== undefined &&
        (typeof item.gramsPerUnit !== "number" ||
          !Number.isFinite(item.gramsPerUnit) ||
          item.gramsPerUnit < 0 ||
          item.gramsPerUnit > 10000))
    ) {
      return { ok: false, error: "invalid_input" };
    }
  }
  for (const entry of input.eaten) {
    if (
      typeof entry?.itemId !== "string" || entry.itemId.length > 100 ||
      typeof entry?.units !== "number" || !Number.isFinite(entry.units) || entry.units < 0 ||
      // Phase 1: per-entry grams override is optional. When present it
      // must be a finite, non-negative number bounded by the session
      // budget ceiling (10000g) to mirror the DB CHECK range and block
      // garbage-sized payloads.
      (entry.grams !== undefined &&
        (typeof entry.grams !== "number" ||
          !Number.isFinite(entry.grams) ||
          entry.grams < 0 ||
          entry.grams > 10000))
    ) {
      return { ok: false, error: "invalid_input" };
    }
  }

  if (typeof input.restaurantName === "string" && input.restaurantName.length > 255) {
    return { ok: false, error: "invalid_input" };
  }

  // Steps 3–4 — resolve the canonical restaurant. Only runs when the client
  // provided a Google Place ID (autocomplete flow). Manual-name sessions
  // skip this and save with restaurant_id = null.
  let restaurantId: string | null = null;

  if (hasPlaceId) {
    // Step 3 — re-fetch the canonical place server-side. Never trust
    // client-supplied name/address/lat/lng (Appendix B #5).
    let place: Awaited<ReturnType<typeof fetchPlaceDetails>>;
    try {
      place = await fetchPlaceDetails(input.googlePlaceId!);
    } catch (err) {
      if (err instanceof PlacesApiError) {
        return { ok: false, error: `places:${err.code}` };
      }
      return { ok: false, error: "places:unknown_error" };
    }

    // Step 4 — upsert the canonical restaurant row via the service-role admin
    // client. This is the ONLY place in the codebase that uses the admin
    // client to write to a shared table; anything else must go through the
    // authenticated server client + RLS (Appendix B #4).
    const admin = createAdminClient();
    const restaurantRow: RestaurantsInsert = {
      google_place_id: place.googlePlaceId,
      name: place.name,
      formatted_address: place.formattedAddress,
      lat: place.lat,
      lng: place.lng,
    };
    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .upsert(restaurantRow, {
        onConflict: "google_place_id",
        ignoreDuplicates: false,
      })
      .select("id")
      .single();

    if (restaurantError || !restaurant) {
      return { ok: false, error: "restaurant_upsert_failed" };
    }

    restaurantId = restaurant.id;
  }

  // Step 5 — compute totals. Single source of truth in lib/calc.ts
  // (Appendix B #14) — never duplicate the math here.
  const { total, margin, won } = computeTotals(
    input.library,
    input.eaten,
    input.buffetPrice,
  );

  // Step 6 — insert the session record via the AUTHENTICATED server client.
  // RLS enforces `auth.uid() = user_id` as a belt-and-braces check; we also
  // set user_id explicitly to match. Idempotency key: (user_id,
  // client_session_id) — a retry lands on the same row thanks to the unique
  // index from supabase/migrations/0001_init.sql.
  const sessionRow: SessionRecordsInsert = {
    user_id: user.id,
    restaurant_id: restaurantId,
    restaurant_name: input.restaurantName ?? null,
    client_session_id: input.clientSessionId,
    buffet_price: input.buffetPrice,
    appetite_budget: input.appetiteBudget,
    // Phase 1: nullable grams-based budget. `undefined` from legacy
    // clients lands as null (DB column is nullable by design).
    appetite_budget_grams: input.appetiteBudgetGrams ?? null,
    // supabase-js serialises these jsonb columns automatically — do NOT
    // JSON.stringify (Appendix B, Phase 3 anti-pattern list).
    library: input.library as unknown as Database["public"]["Tables"]["session_records"]["Insert"]["library"],
    eaten: input.eaten as unknown as Database["public"]["Tables"]["session_records"]["Insert"]["eaten"],
    total_eaten_value: total,
    margin,
    won,
    started_at: input.startedAt,
    finished_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertError } = await supabase
    .from("session_records")
    .upsert(sessionRow, {
      onConflict: "user_id,client_session_id",
      ignoreDuplicates: false,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return { ok: false, error: "session_insert_failed" };
  }

  // Best-effort cache invalidation for the history list/detail pages so the
  // next visit reflects the new row without a hard reload.
  revalidatePath("/history");
  revalidatePath(`/history/${inserted.id}`);
  revalidatePath("/stats");

  return { ok: true, id: inserted.id };
}
