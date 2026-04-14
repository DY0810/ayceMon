import "server-only";

import type { ResolvedPlace } from "@/lib/types";

// Google Places API (New) — endpoints + field masks. See plans/.phase0-notes.md
// for the canonical SKU/billing notes that justify these field masks. The
// `displayName` field on Place Details bumps the call to "Place Details Pro"
// pricing — that is intentional, because we need the canonical name to dedupe
// the shared `restaurants` table in Phase 3.
const PLACES_BASE_URL = "https://places.googleapis.com/v1";

const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat";

const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location";

export interface AutocompleteSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
}

export interface LocationBias {
  lat: number;
  lng: number;
  radius: number; // metres
}

export class PlacesApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "PlacesApiError";
    this.status = status;
    this.code = code;
  }
}

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new PlacesApiError(
      "Google Places API key is not configured.",
      500,
      "missing_api_key",
    );
  }
  return key;
}

interface AutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

interface PlaceDetailsResponse {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

export async function fetchAutocomplete(
  input: string,
  sessionToken: string,
  bias?: LocationBias,
): Promise<AutocompleteSuggestion[]> {
  if (input.trim().length < 3) {
    // Server-side defence-in-depth — the route handler also enforces this.
    throw new PlacesApiError(
      "Input must be at least 3 characters.",
      400,
      "input_too_short",
    );
  }

  // Do NOT use includedPrimaryTypes here. Google Places API (New) has 200+
  // specific food types (korean_restaurant, sushi_restaurant, buffet_restaurant,
  // etc.) and the filter only matches the single PRIMARY type. The "food" Table
  // B type is allowed but it's unclear whether it groups all food Table A types.
  // With a max of 5 values we can't enumerate them, so we omit the filter and
  // let the search text + location bias do the ranking instead.
  const body: Record<string, unknown> = {
    input,
    sessionToken,
    includeQueryPredictions: false,
  };

  if (bias) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.lat, longitude: bias.lng },
        radius: bias.radius,
      },
    };
  }

  let res: Response;
  try {
    res = await fetch(`${PLACES_BASE_URL}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": getApiKey(),
        "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PlacesApiError(
      "Failed to reach Google Places.",
      502,
      "upstream_unreachable",
    );
  }

  if (!res.ok) {
    // Never leak Google's raw error body to clients — it can include the
    // request payload echo and internal status codes.
    throw new PlacesApiError(
      "Google Places autocomplete failed.",
      res.status === 429 ? 429 : 502,
      res.status === 429 ? "upstream_rate_limited" : "upstream_error",
    );
  }

  const json = (await res.json()) as AutocompleteResponse;
  const suggestions = json.suggestions ?? [];

  const out: AutocompleteSuggestion[] = [];
  for (const s of suggestions) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    const primary =
      p.structuredFormat?.mainText?.text ?? p.text?.text ?? "Unknown place";
    const secondary = p.structuredFormat?.secondaryText?.text ?? "";
    out.push({ placeId: p.placeId, primaryText: primary, secondaryText: secondary });
  }
  return out;
}

export async function fetchPlaceDetails(placeId: string): Promise<ResolvedPlace> {
  if (!placeId || typeof placeId !== "string") {
    throw new PlacesApiError("placeId is required.", 400, "missing_place_id");
  }

  let res: Response;
  try {
    res = await fetch(
      `${PLACES_BASE_URL}/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": getApiKey(),
          "X-Goog-FieldMask": DETAILS_FIELD_MASK,
        },
      },
    );
  } catch {
    throw new PlacesApiError(
      "Failed to reach Google Places.",
      502,
      "upstream_unreachable",
    );
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new PlacesApiError("Place not found.", 404, "place_not_found");
    }
    throw new PlacesApiError(
      "Google Places details failed.",
      res.status === 429 ? 429 : 502,
      res.status === 429 ? "upstream_rate_limited" : "upstream_error",
    );
  }

  const json = (await res.json()) as PlaceDetailsResponse;
  const id = json.id;
  const name = json.displayName?.text;
  const formattedAddress = json.formattedAddress;
  const lat = json.location?.latitude;
  const lng = json.location?.longitude;

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof formattedAddress !== "string" ||
    typeof lat !== "number" ||
    typeof lng !== "number"
  ) {
    throw new PlacesApiError(
      "Google Places details response missing required fields.",
      502,
      "upstream_malformed",
    );
  }

  return {
    googlePlaceId: id,
    name,
    formattedAddress,
    lat,
    lng,
  };
}
