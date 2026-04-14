"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/require-user";
import { computeTotals } from "@/lib/calc";
import { fetchPlaceDetails, PlacesApiError } from "@/lib/places/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { Session } from "@/lib/types";

type SessionRecordsInsert =
  Database["public"]["Tables"]["session_records"]["Insert"];
type RestaurantsInsert =
  Database["public"]["Tables"]["restaurants"]["Insert"];

export interface MigrateResult {
  promoted: string[];
  skipped: { id: string; reason: "not_finished" }[];
  failed: { id: string; error: string }[];
}

export async function promoteGuestSessions(
  sessions: Session[],
): Promise<MigrateResult> {
  const { user, supabase } = await requireUser();
  const admin = createAdminClient();

  const result: MigrateResult = {
    promoted: [],
    skipped: [],
    failed: [],
  };

  if (!Array.isArray(sessions) || sessions.length > 100) {
    result.failed.push({ id: "input", error: "too_many_sessions" });
    return result;
  }

  for (const session of sessions) {
    // Skip sessions that haven't been finished.
    if (!session.finishedAt) {
      result.skipped.push({ id: session.id, reason: "not_finished" });
      continue;
    }

    try {
      // Step 1 — resolve the canonical restaurant only when the guest
      // captured a Google Place at setup. Sessions without one promote
      // with restaurant_id = null + restaurant_name fallback, mirroring
      // finishAndSaveSession's manual-name path.
      let restaurantId: string | null = null;

      if (session.resolvedPlace) {
        const place = await fetchPlaceDetails(
          session.resolvedPlace.googlePlaceId,
        );

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
          result.failed.push({
            id: session.id,
            error: "restaurant_upsert_failed",
          });
          continue;
        }

        restaurantId = restaurant.id;
      }

      // Step 2 — compute totals via the single source of truth.
      const { total, margin, won } = computeTotals(
        session.library,
        session.eaten,
        session.buffetPrice,
      );

      // Step 3 — upsert session record with DB-level idempotency.
      // The unique index on (user_id, client_session_id) makes this safe
      // against double-tab races, network retries, and full-page reloads.
      const sessionRow: SessionRecordsInsert = {
        user_id: user.id,
        restaurant_id: restaurantId,
        restaurant_name: session.restaurantName ?? null,
        client_session_id: session.id,
        buffet_price: session.buffetPrice,
        appetite_budget: session.appetiteBudget,
        library: session.library as unknown as SessionRecordsInsert["library"],
        eaten: session.eaten as unknown as SessionRecordsInsert["eaten"],
        total_eaten_value: total,
        margin,
        won,
        started_at: new Date(session.startedAt).toISOString(),
        finished_at: new Date(session.finishedAt).toISOString(),
      };

      const { error: insertError } = await supabase
        .from("session_records")
        .upsert(sessionRow, {
          onConflict: "user_id,client_session_id",
          ignoreDuplicates: true,
        });

      if (insertError) {
        result.failed.push({ id: session.id, error: "session_insert_failed" });
        continue;
      }

      result.promoted.push(session.id);
    } catch (err) {
      const message =
        err instanceof PlacesApiError
          ? `places:${err.code}`
          : "unknown_error";
      result.failed.push({ id: session.id, error: message });
    }
  }

  // Best-effort cache invalidation if anything was promoted.
  if (result.promoted.length > 0) {
    revalidatePath("/history");
    revalidatePath("/stats");
  }

  return result;
}
