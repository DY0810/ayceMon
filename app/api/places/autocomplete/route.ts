import "server-only";
import { NextResponse } from "next/server";

import {
  fetchAutocomplete,
  PlacesApiError,
  type LocationBias,
} from "@/lib/places/resolve";
import { getClientIp, rateLimit } from "@/lib/places/rate-limit";

interface AutocompleteBody {
  input?: unknown;
  sessionToken?: unknown;
  bias?: unknown;
}

function parseBias(raw: unknown): LocationBias | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as { lat?: unknown; lng?: unknown; radius?: unknown };
  if (
    typeof candidate.lat !== "number" ||
    typeof candidate.lng !== "number" ||
    typeof candidate.radius !== "number"
  ) {
    return undefined;
  }
  if (
    candidate.lat < -90 || candidate.lat > 90 ||
    candidate.lng < -180 || candidate.lng > 180 ||
    candidate.radius < 1 || candidate.radius > 50_000 ||
    !Number.isFinite(candidate.lat) ||
    !Number.isFinite(candidate.lng) ||
    !Number.isFinite(candidate.radius)
  ) {
    return undefined;
  }
  return { lat: candidate.lat, lng: candidate.lng, radius: candidate.radius };
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

  let body: AutocompleteBody;
  try {
    body = (await request.json()) as AutocompleteBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const input = typeof body.input === "string" ? body.input : "";
  const sessionToken =
    typeof body.sessionToken === "string" ? body.sessionToken : "";

  if (input.length > 200) {
    return NextResponse.json({ error: "input_too_long" }, { status: 400 });
  }

  // Billing footgun guard: debounce alone is not enough. Reject here so a
  // buggy client cannot burn the Autocomplete Requests SKU.
  if (input.trim().length < 3) {
    return NextResponse.json({ error: "input_too_short" }, { status: 400 });
  }
  if (!sessionToken) {
    return NextResponse.json(
      { error: "missing_session_token" },
      { status: 400 },
    );
  }

  const bias = parseBias(body.bias);

  try {
    const suggestions = await fetchAutocomplete(input, sessionToken, bias);
    return NextResponse.json({ suggestions });
  } catch (err) {
    if (err instanceof PlacesApiError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
