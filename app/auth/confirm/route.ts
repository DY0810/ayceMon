import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

// Supabase email confirmation flow:
// The link in the confirmation email redirects here with
// `?token_hash=...&type=email|signup|...&next=/optional-path`.
// We swap the token hash for a session cookie via `verifyOtp`, then redirect.
//
// Route Handlers use Web Request/Response; `request.nextUrl.searchParams` is
// the canonical way to read query params per:
//   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
// `cookies()` inside the awaited server client is async per:
//   node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next") ?? "/";
  // Only allow relative paths — reject absolute URLs and protocol-relative
  // URLs to prevent open-redirect attacks after OTP verification.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!token_hash || !type) {
    return NextResponse.redirect(
      new URL("/login?error=confirm_failed", request.url),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=confirm_failed", request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
