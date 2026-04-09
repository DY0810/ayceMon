import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

// Next 16: cookies() is async and returns a Promise. Any Supabase snippet
// that does `const cookieStore = cookies()` will crash at runtime.
// See node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md
// (lines 6, 67) for the authoritative rule.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore because
            // proxy.ts refreshes the session on every request anyway.
          }
        },
      },
    },
  );
}
