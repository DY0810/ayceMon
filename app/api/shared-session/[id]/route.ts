import "server-only";

import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/require-user";

// GET /api/shared-session/:id
//
// Polling endpoint for the tracker/library/result pages. Returns the shared
// session's metadata, the full library, the full entries list, and the
// roster of collaborators. RLS is the access-control boundary: a caller
// that isn't the owner or a collaborator will see empty/null results and
// receive a 404 here.
//
// Next 16: `params` is an async prop — await it before reading (see
// node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
// line 195 for the canonical example). We enforce the UUID shape on
// the segment before querying the DB.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { supabase } = await requireUser();

  const [sessionRes, itemsRes, entriesRes, collabsRes] = await Promise.all([
    supabase
      .from("shared_sessions")
      .select(
        "id, owner_user_id, restaurant_id, restaurant_name, buffet_price, appetite_budget, appetite_budget_grams, city_tier, resolved_place, started_at, finished_at, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("shared_session_items")
      .select(
        "id, session_id, name, ala_carte_value, fill_factor, grams_per_unit, category, source_kind, source_ref",
      )
      .eq("session_id", id),
    supabase
      .from("shared_session_entries")
      .select("id, session_id, user_id, item_id, units, grams, logged_at")
      .eq("session_id", id),
    supabase
      .from("shared_session_collaborators")
      .select("session_id, user_id, role, joined_at")
      .eq("session_id", id),
  ]);

  if (sessionRes.error) {
    return NextResponse.json(
      { error: "session_lookup_failed" },
      { status: 500 },
    );
  }
  if (!sessionRes.data) {
    // RLS masks non-member reads as empty rows, so this is either "session
    // doesn't exist" or "caller isn't a collaborator". Same 404 either way —
    // we don't leak the distinction.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (itemsRes.error || entriesRes.error || collabsRes.error) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  return NextResponse.json({
    session: sessionRes.data,
    items: itemsRes.data ?? [],
    entries: entriesRes.data ?? [],
    collaborators: collabsRes.data ?? [],
  });
}
