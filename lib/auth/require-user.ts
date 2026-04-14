import "server-only";

import { redirect } from "next/navigation";

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
