import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

// Next 16 renamed the middleware file convention to proxy.ts. This helper
// is the session-refresh body that proxy.ts calls on every request.
// See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
// and node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // CRITICAL: Do NOT add any code between createServerClient() and
  // supabase.auth.getClaims(). A stray await or intermediate call here
  // can cause users to be randomly logged out — Supabase's upstream
  // example is explicit about this, and Phase 2 must preserve the order.
  const { data } = await supabase.auth.getClaims();
  void data; // presence of the call is what refreshes the session

  // MUST return supabaseResponse as-is — do not replace or wrap it.
  return supabaseResponse;
}
