import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type {
  Restaurant,
  RestaurantStats,
  SessionRecord,
  UserStats,
} from "@/lib/types";

type SupabaseDb = SupabaseClient<Database>;

/**
 * Lifetime totals from the `user_stats` view (security_invoker, RLS-scoped).
 * Returns null when the user has zero sessions.
 */
export async function getUserStats(
  supabase: SupabaseDb,
): Promise<UserStats | null> {
  const { data, error } = await supabase
    .from("user_stats")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    totalSessions: data.total_sessions ?? 0,
    totalWins: data.total_wins ?? 0,
    totalLosses: data.total_losses ?? 0,
    totalMargin: Number(data.total_margin ?? 0),
    bestMargin: Number(data.best_margin ?? 0),
    worstMargin: Number(data.worst_margin ?? 0),
  };
}

/**
 * Per-restaurant aggregates from the `restaurant_stats` view, most recently
 * visited first.
 */
export async function getRestaurantStats(
  supabase: SupabaseDb,
): Promise<RestaurantStats[]> {
  const { data, error } = await supabase
    .from("restaurant_stats")
    .select("*")
    .order("last_visited_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    restaurantId: row.restaurant_id ?? "",
    restaurantName: row.restaurant_name ?? "",
    sessions: row.sessions ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    totalMargin: Number(row.total_margin ?? 0),
    lastVisitedAt: row.last_visited_at ?? "",
  }));
}

/**
 * All sessions the current user has at a specific restaurant, newest first.
 * Uses the base `session_records` table (RLS-scoped by user_id).
 */
export async function getSessionsAtRestaurant(
  supabase: SupabaseDb,
  restaurantId: string,
): Promise<SessionRecord[]> {
  const { data, error } = await supabase
    .from("session_records")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("finished_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    restaurantId: row.restaurant_id,
    clientSessionId: row.client_session_id,
    buffetPrice: Number(row.buffet_price),
    appetiteBudget: row.appetite_budget,
    library: row.library as unknown as SessionRecord["library"],
    eaten: row.eaten as unknown as SessionRecord["eaten"],
    totalEatenValue: Number(row.total_eaten_value),
    margin: Number(row.margin),
    won: row.won,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}

/**
 * Fetch a single restaurant by its internal UUID.
 * Returns null if the restaurant doesn't exist or the user has no access.
 */
export async function getRestaurantById(
  supabase: SupabaseDb,
  restaurantId: string,
): Promise<Restaurant | null> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", restaurantId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    googlePlaceId: data.google_place_id,
    name: data.name,
    formattedAddress: data.formatted_address,
    lat: data.lat,
    lng: data.lng,
    createdAt: data.created_at,
  };
}
