"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Server Function for signing the user out.
//
// Notes:
// - `createClient()` from `lib/supabase/server.ts` is async because Next 16
//   `cookies()` is async (see node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md).
// - `redirect()` throws a NEXT_REDIRECT error, so it MUST be called outside
//   any try/catch (see node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md).
// - Passing server actions as props to Client Components is supported
//   (see node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md,
//   "Passing actions as props").
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
