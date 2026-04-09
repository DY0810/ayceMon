import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

// Next 16 renamed `middleware.ts` to `proxy.ts` at the repo root (or inside
// `src/`). See:
//   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
//   node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md
// The file MUST live at the repo root (alongside `app/`), not inside `app/`.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

// Broader image negative-lookahead than the legacy Supabase example, per
// Phase 0 notes — covers .jpeg/.gif/.webp which the trimmed matcher missed.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
