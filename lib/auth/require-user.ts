import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

// Server-only auth guard for pages and server actions.
// Returns both the user and the pre-built Supabase client so callers don't
// instantiate it twice per request.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return { user, supabase };
}

// API-route variant: returns a 401 JSON response when unauthenticated
// instead of redirecting (fetch clients don't follow redirects to
// auth pages cleanly). Callers receive either the authed user+client
// or a NextResponse to return immediately.
type RequireUserApiResult =
  | { ok: true; user: User; supabase: SupabaseClient }
  | { ok: false; response: NextResponse };

export async function requireUserForApi(): Promise<RequireUserApiResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, user, supabase };
}
