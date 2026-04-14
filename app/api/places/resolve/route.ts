import "server-only";
import { NextResponse } from "next/server";

import { fetchPlaceDetails, PlacesApiError } from "@/lib/places/resolve";
import { getClientIp, rateLimit } from "@/lib/places/rate-limit";

interface ResolveBody {
  placeId?: unknown;
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const placeId = typeof body.placeId === "string" ? body.placeId : "";
  if (!placeId) {
    return NextResponse.json({ error: "missing_place_id" }, { status: 400 });
  }
  if (placeId.length > 300) {
    return NextResponse.json({ error: "invalid_place_id" }, { status: 400 });
  }

  try {
    const place = await fetchPlaceDetails(placeId);
    return NextResponse.json({ place });
  } catch (err) {
    if (err instanceof PlacesApiError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
