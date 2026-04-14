export type ItemId = string;

export type PriceSource = "user" | "seed" | "estimate";

export type CityTier =
  | "metro-premium"
  | "metro-standard"
  | "suburban"
  | "rural";

export interface Item {
  id: ItemId;
  name: string;
  alaCarteValue: number;
  fillFactor: number;
  // Phase 1 (collab-and-quantitative-appetite): grams per unit drives the
  // grams-based fullness model. Optional for back-compat with library
  // items already persisted in Zustand before this release.
  gramsPerUnit?: number;
  category?: string;
  sourceKind?: PriceSource;
  sourceRef?: string;
}

export interface EatenEntry {
  itemId: ItemId;
  units: number;
  // Phase 1: optional direct grams override. When set, it wins over
  // `units * item.gramsPerUnit` in computeFullness.
  grams?: number;
  // Phase 7 (collab-and-quantitative-appetite): per-entry attribution
  // preserved in the finalized `session_records.eaten` jsonb. Set by
  // `finalizeSharedSession` for shared sessions; absent for solo
  // sessions. Consumers (/history/[id]) group rows by this when
  // `session_records.contributors` is non-empty.
  userId?: string;
}

export interface Session {
  id: string;
  restaurantName?: string;
  buffetPrice: number;
  appetiteBudget: number;
  // Phase 1: grams-based budget target. null = user opted out
  // ("skip, I'll eyeball it"). undefined = legacy pre-grams session.
  appetiteBudgetGrams?: number | null;
  library: Item[];
  eaten: EatenEntry[];
  startedAt: number;
  finishedAt?: number;
  cityTier?: CityTier;
  // Phase 1 addition (user-auth-history-places plan): the resolved Places
  // entity for this draft session. Populated by the Phase 5 combobox; read
  // by the Phase 3 server action at finish time. Only `googlePlaceId` is
  // ever trusted server-side — the other fields are display-only and the
  // server re-fetches Places Details before persisting.
  resolvedPlace?: ResolvedPlace;
  // Phase 7 (collab-and-quantitative-appetite): per-user attribution for
  // a finalized shared session projected into the draft shape. Solo
  // sessions always leave this empty / absent — the /result page's
  // flat-vs-grouped branch uses `contributors?.length > 0` as the gate.
  contributors?: SessionContributor[];
}

// ---------------------------------------------------------------------------
// user-auth-history-places plan — persisted domain model
//
// These types describe rows that live in Supabase (see
// supabase/migrations/0001_init.sql). The in-progress draft `Session`
// above stays client-only; a *finished* session gets promoted to a
// `SessionRecord` by the Phase 3 server action.
// ---------------------------------------------------------------------------

export type UserId = string; // Supabase auth.users.id (uuid)
export type RestaurantId = string; // our restaurants.id (uuid), NOT the Google place_id
export type SessionRecordId = string;

/** A canonical restaurant, keyed by Google Place ID. Shared across all users.
 *  All fields except `googlePlaceId` are populated server-side from the
 *  Places Details API — never from client-submitted data. */
export interface Restaurant {
  id: RestaurantId; // our internal uuid
  googlePlaceId: string; // Google's place_id — UNIQUE
  name: string; // canonical display name from Places
  formattedAddress: string;
  lat: number;
  lng: number;
  createdAt: string; // ISO
}

/** Added to Session (in-progress draft buffer) above — used by Phases 3/5. */
export interface ResolvedPlace {
  googlePlaceId: string; // the ONLY field the server trusts
  name: string; // display-only; server re-fetches before persist
  formattedAddress: string; // display-only
  lat: number; // display-only
  lng: number; // display-only
}

/** A finished session belonging to a user. Abandoned sessions never land here. */
export interface SessionRecord {
  id: SessionRecordId;
  userId: UserId;
  restaurantId: RestaurantId | null; // null when no Google Place was resolved
  clientSessionId: string; // the draft Session.id from Zustand — idempotency key
  buffetPrice: number;
  appetiteBudget: number;
  // Phase 1 (collab-and-quantitative-appetite): grams-based budget. null
  // when the user opted out; undefined when the session predates grams.
  appetiteBudgetGrams?: number | null;
  library: Item[]; // snapshot at finish time
  eaten: EatenEntry[]; // snapshot at finish time
  totalEatenValue: number; // denormalized for fast stats
  margin: number; // totalEatenValue - buffetPrice
  won: boolean; // totalEatenValue >= buffetPrice
  startedAt: string; // ISO
  finishedAt: string; // ISO — NOT NULL, only finished sessions land in DB
}

/** Aggregated stats — materialized via a SQL view, not stored. */
export interface UserStats {
  totalSessions: number;
  totalWins: number;
  totalLosses: number;
  totalMargin: number; // sum of margins across all sessions (can be negative)
  bestMargin: number;
  worstMargin: number;
}

export interface RestaurantStats {
  restaurantId: RestaurantId;
  restaurantName: string;
  sessions: number;
  wins: number;
  losses: number;
  totalMargin: number;
  lastVisitedAt: string; // ISO
}

// ---------------------------------------------------------------------------
// collab-and-quantitative-appetite plan, Phase 6 — shared-session model.
//
// These types describe rows in the four `shared_*` tables (see
// supabase/migrations/0005_shared_sessions.sql). They are the server-backed
// equivalent of the Zustand `Session` above, but spread across per-row
// records so multiple users can write to the same session concurrently.
//
// On finalize, a shared session aggregates into exactly one `session_records`
// row. The `session_records.contributors` jsonb column holds the per-user
// attribution snapshot described by `SessionContributor` below.
// ---------------------------------------------------------------------------

export type SharedSessionId = string;

export type SharedSessionRole = "owner" | "collaborator";

export interface SharedSession {
  id: SharedSessionId;
  ownerUserId: UserId;
  restaurantId: RestaurantId | null;
  restaurantName: string | null;
  buffetPrice: number;
  appetiteBudget: number | null;
  appetiteBudgetGrams: number | null;
  cityTier: CityTier | null;
  resolvedPlace: ResolvedPlace | null;
  startedAt: string; // ISO
  finishedAt: string | null; // ISO, null while the session is active
  createdAt: string; // ISO
}

export interface SharedSessionItem {
  sessionId: SharedSessionId;
  id: ItemId;
  name: string;
  alaCarteValue: number;
  fillFactor: number;
  gramsPerUnit: number | null;
  category: string | null;
  sourceKind: PriceSource | null;
  sourceRef: string | null;
}

export interface SharedSessionCollaborator {
  sessionId: SharedSessionId;
  userId: UserId;
  role: SharedSessionRole;
  joinedAt: string; // ISO
}

export interface SharedSessionEntry {
  id: string; // surrogate uuid
  sessionId: SharedSessionId;
  userId: UserId;
  itemId: ItemId;
  units: number;
  grams: number | null;
  loggedAt: string; // ISO
}

/** Per-user attribution snapshot persisted on `session_records.contributors`.
 *  Recomputed at finalize time from the aggregated entries; never updated
 *  after the session_records row lands. */
export interface SessionContributor {
  userId: UserId;
  units: number; // total units logged by this user
  grams: number; // total grams logged by this user (null entries + unit×gpu)
  valueEaten: number; // total à-la-carte value attributed to this user
}
