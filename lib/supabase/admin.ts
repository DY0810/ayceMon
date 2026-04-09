import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// SERVER ONLY — never import from a "use client" file. The `server-only`
// import above makes any client-bundle import a build-time error.
//
// Uses the service role key and bypasses RLS. Use only for the restaurants
// upsert path in the finishAndSaveSession server action (Phase 3), after
// re-resolving the placeId via Places Details — never with client-supplied
// name/address/lat/lng, which must not be trusted.
export const createAdminClient = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
