import "server-only";

import { NextResponse } from "next/server";

import { listContributors } from "@/app/actions/shared-session";
import type { SharedSessionId } from "@/lib/types";

// GET /api/shared-session/:id/contributors
//
// Thin REST wrapper over the `listContributors` server action. The
// production tracker UI reads `contributors` from `useSharedSession`'s
// polled payload (Phase 4 of plans/multi-user-tracking-k8s-brand.md);
// this endpoint is the reusable surface for debug tooling, future mobile
// clients, and server-side rendering.
//
// Status mapping matches the sibling /api/shared-session/:id endpoint:
//   200 — aggregated list (possibly empty when RLS masks a non-member)
//   400 — malformed UUID (surfaced as `invalid_session_id` by the action)
//   500 — DB error
// requireUser() redirects unauthenticated callers before we get here.

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const result = await listContributors(id as SharedSessionId);
  if (!result.ok) {
    const status = result.error === "invalid_session_id" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ contributors: result.data });
}
