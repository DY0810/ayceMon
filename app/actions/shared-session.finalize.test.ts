import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock `server-only` so importing shared-session.ts doesn't throw when
// vitest runs it outside the Next.js server runtime.
vi.mock("server-only", () => ({}));

// Mock next/cache — finalizeSharedSession calls revalidatePath on success.
// The tests don't care about cache behaviour; they just need the call to
// no-op. Do NOT import the real next/cache: it requires Next's async
// storage and throws "Invariant: static generation store missing" outside
// a request.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock next/navigation for requireUser.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

// Mock requireUser — the server action's auth boundary. Tests that want
// to simulate "not signed in" override this per-test.
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const COLLAB_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";

// Supabase-like response shape
interface SBResponse<T = unknown> {
  data: T;
  error: unknown;
}

// Records produced by finalizeSharedSession's upsert.
interface SessionRecordRow {
  id: string;
  user_id: string;
  client_session_id: string;
  total_eaten_value: number;
  margin: number;
  won: boolean;
  contributors: unknown;
  appetite_budget: number;
  [k: string]: unknown;
}

type MockSupabase = {
  from: (table: string) => unknown;
  _state: {
    sessions: Map<string, Record<string, unknown>>;
    items: Array<Record<string, unknown>>;
    entries: Array<Record<string, unknown>>;
    records: SessionRecordRow[];
    recordIdCounter: number;
    sessionUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
    lastUpsertConflict?: string;
  };
};

// Build a mock supabase client that routes queries by table name. It is
// intentionally narrow — covers only the calls finalizeSharedSession makes.
function buildMockSupabase(seed: {
  session: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  entries: Array<Record<string, unknown>>;
  preExistingRecord?: SessionRecordRow;
}): MockSupabase {
  const state: MockSupabase["_state"] = {
    sessions: new Map([[seed.session.id as string, { ...seed.session }]]),
    items: seed.items.map((i) => ({ ...i })),
    entries: seed.entries.map((e) => ({ ...e })),
    records: seed.preExistingRecord ? [{ ...seed.preExistingRecord }] : [],
    recordIdCounter: 1,
    sessionUpdates: [],
  };

  const fromSharedSessions = () => {
    const state2 = state;
    return {
      _eqs: {} as Record<string, unknown>,
      _mode: "" as "select" | "update",
      _patch: undefined as undefined | Record<string, unknown>,
      _selectColumns: "" as string,
      select(cols: string) {
        this._mode = "select";
        this._selectColumns = cols;
        return this;
      },
      update(patch: Record<string, unknown>) {
        this._mode = "update";
        this._patch = patch;
        return this;
      },
      eq(col: string, val: unknown) {
        this._eqs[col] = val;
        return this;
      },
      async maybeSingle(): Promise<SBResponse> {
        const id = this._eqs.id as string | undefined;
        if (!id) return { data: null, error: null };
        const row = state2.sessions.get(id);
        return { data: row ?? null, error: null };
      },
      then(resolve: (r: SBResponse) => void) {
        // update path returns a thenable with no explicit await on select
        if (this._mode === "update") {
          const id = this._eqs.id as string;
          const row = state2.sessions.get(id);
          if (row) {
            Object.assign(row, this._patch ?? {});
            state2.sessionUpdates.push({ id, patch: { ...(this._patch ?? {}) } });
          }
          resolve({ data: null, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
  };

  const fromSharedSessionItems = () => ({
    _eqs: {} as Record<string, unknown>,
    select() {
      return this;
    },
    eq(col: string, val: unknown) {
      this._eqs[col] = val;
      return this;
    },
    then(resolve: (r: SBResponse) => void) {
      const sid = this._eqs.session_id as string | undefined;
      const rows = state.items.filter((r) => r.session_id === sid);
      resolve({ data: rows, error: null });
    },
  });

  const fromSharedSessionEntries = () => ({
    _eqs: {} as Record<string, unknown>,
    select() {
      return this;
    },
    eq(col: string, val: unknown) {
      this._eqs[col] = val;
      return this;
    },
    then(resolve: (r: SBResponse) => void) {
      const sid = this._eqs.session_id as string | undefined;
      const rows = state.entries.filter((r) => r.session_id === sid);
      resolve({ data: rows, error: null });
    },
  });

  const fromSessionRecords = () => ({
    _row: undefined as undefined | Record<string, unknown>,
    _conflict: undefined as string | undefined,
    upsert(
      row: Record<string, unknown>,
      opts?: { onConflict?: string; ignoreDuplicates?: boolean },
    ) {
      this._row = row;
      this._conflict = opts?.onConflict;
      state.lastUpsertConflict = opts?.onConflict;
      return this;
    },
    select() {
      return this;
    },
    async single(): Promise<SBResponse> {
      if (!this._row) return { data: null, error: null };
      const userId = this._row.user_id as string;
      const clientSessionId = this._row.client_session_id as string;

      // Honour onConflict = "user_id,client_session_id" semantics.
      const existing = state.records.find(
        (r) =>
          r.user_id === userId && r.client_session_id === clientSessionId,
      );

      if (existing) {
        // Idempotent retry: update in place, return existing id.
        Object.assign(existing, this._row, { id: existing.id });
        return { data: { id: existing.id }, error: null };
      }

      const id = `rec-${state.recordIdCounter++}`;
      const newRow = { ...this._row, id } as SessionRecordRow;
      state.records.push(newRow);
      return { data: { id }, error: null };
    },
  });

  return {
    _state: state,
    from(table: string) {
      switch (table) {
        case "shared_sessions":
          return fromSharedSessions();
        case "shared_session_items":
          return fromSharedSessionItems();
        case "shared_session_entries":
          return fromSharedSessionEntries();
        case "session_records":
          return fromSessionRecords();
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
  };
}

// Install the requireUser mock — each test can override user.id.
let currentUserId = OWNER_ID;
let currentSupabase: MockSupabase;
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({
    user: { id: currentUserId },
    supabase: currentSupabase,
  }),
}));

// Import after mocks are declared.
import { finalizeSharedSession } from "./shared-session";

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    owner_user_id: OWNER_ID,
    restaurant_id: null,
    restaurant_name: "Test Buffet",
    buffet_price: 30,
    appetite_budget: 50,
    appetite_budget_grams: 1500,
    started_at: "2026-04-13T18:00:00.000Z",
    finished_at: null,
    ...overrides,
  };
}

function buildItem(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION_ID,
    id: "itm-1",
    name: "Sushi Roll",
    ala_carte_value: "10.00",
    fill_factor: "1.0",
    grams_per_unit: "100",
    category: null,
    source_kind: null,
    source_ref: null,
    ...overrides,
  };
}

function buildEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "ent-1",
    session_id: SESSION_ID,
    user_id: OWNER_ID,
    item_id: "itm-1",
    units: "2",
    grams: null,
    ...overrides,
  };
}

describe("finalizeSharedSession", () => {
  beforeEach(() => {
    currentUserId = OWNER_ID;
  });

  it("aggregates single-collaborator totals correctly", async () => {
    // One owner, two items, two entries. total = 2*10 + 1*25 = 45. Buffet $30.
    const items = [
      buildItem({ id: "itm-1", name: "Sushi", ala_carte_value: "10" }),
      buildItem({ id: "itm-2", name: "Steak", ala_carte_value: "25" }),
    ];
    const entries = [
      buildEntry({ id: "e1", user_id: OWNER_ID, item_id: "itm-1", units: "2" }),
      buildEntry({ id: "e2", user_id: OWNER_ID, item_id: "itm-2", units: "1" }),
    ];
    currentSupabase = buildMockSupabase({
      session: buildSession(),
      items,
      entries,
    });

    const res = await finalizeSharedSession({ sessionId: SESSION_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const records = currentSupabase._state.records;
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.user_id).toBe(OWNER_ID);
    expect(rec.client_session_id).toBe(SESSION_ID);
    expect(rec.total_eaten_value).toBe(45);
    expect(rec.margin).toBe(15);
    expect(rec.won).toBe(true);

    const contribs = rec.contributors as Array<{
      userId: string;
      units: number;
      grams: number;
      valueEaten: number;
    }>;
    expect(contribs).toHaveLength(1);
    expect(contribs[0].userId).toBe(OWNER_ID);
    expect(contribs[0].units).toBe(3);
    expect(contribs[0].valueEaten).toBe(45);
    // grams: 2*100 + 1*100 = 300 (grams_per_unit from both items).
    expect(contribs[0].grams).toBe(300);
  });

  it("preserves per-user attribution for multi-collaborator entries", async () => {
    // Owner logs 2 units of itm-1 at $10 each = $20.
    // Collab logs 1 unit of itm-2 at $25 each + 1 entry with explicit grams.
    const items = [
      buildItem({ id: "itm-1", name: "Sushi", ala_carte_value: "10", grams_per_unit: "100" }),
      buildItem({ id: "itm-2", name: "Steak", ala_carte_value: "25", grams_per_unit: "150" }),
    ];
    const entries = [
      buildEntry({ id: "e1", user_id: OWNER_ID, item_id: "itm-1", units: "2", grams: null }),
      buildEntry({ id: "e2", user_id: COLLAB_ID, item_id: "itm-2", units: "1", grams: null }),
      // Collab also logs an explicit-grams entry on itm-1
      buildEntry({ id: "e3", user_id: COLLAB_ID, item_id: "itm-1", units: "1", grams: "250" }),
    ];
    currentSupabase = buildMockSupabase({
      session: buildSession(),
      items,
      entries,
    });

    const res = await finalizeSharedSession({ sessionId: SESSION_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const rec = currentSupabase._state.records[0];
    // total = 2*10 (owner) + 1*25 (collab) + 1*10 (collab itm-1) = 55
    expect(rec.total_eaten_value).toBe(55);

    const contribs = rec.contributors as Array<{
      userId: string;
      units: number;
      grams: number;
      valueEaten: number;
    }>;
    expect(contribs).toHaveLength(2);

    const ownerC = contribs.find((c) => c.userId === OWNER_ID);
    const collabC = contribs.find((c) => c.userId === COLLAB_ID);
    expect(ownerC).toBeDefined();
    expect(collabC).toBeDefined();
    if (!ownerC || !collabC) return;

    // Owner: 2 units of itm-1 (100g each) = 200g, $20
    expect(ownerC.units).toBe(2);
    expect(ownerC.grams).toBe(200);
    expect(ownerC.valueEaten).toBe(20);

    // Collab: 1 unit of itm-2 (150g) + 1 unit of itm-1 (explicit 250g) = 400g,
    // $25 + $10 = $35, units = 2
    expect(collabC.units).toBe(2);
    expect(collabC.grams).toBe(400);
    expect(collabC.valueEaten).toBe(35);
  });

  it("is idempotent — second call returns same record id and does not duplicate", async () => {
    const items = [buildItem({ id: "itm-1", ala_carte_value: "10" })];
    const entries = [buildEntry({ id: "e1", user_id: OWNER_ID, units: "3" })];
    currentSupabase = buildMockSupabase({
      session: buildSession(),
      items,
      entries,
    });

    const first = await finalizeSharedSession({ sessionId: SESSION_ID });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstId = first.data.id;

    // Confirm the shared_session was marked finished on the first call.
    const sessionRow = currentSupabase._state.sessions.get(SESSION_ID);
    expect(sessionRow?.finished_at).toBeTruthy();
    const firstFinishedAt = sessionRow?.finished_at;

    const second = await finalizeSharedSession({ sessionId: SESSION_ID });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.data.id).toBe(firstId);
    // Still exactly one record.
    expect(currentSupabase._state.records).toHaveLength(1);
    // Upsert used the correct conflict key.
    expect(currentSupabase._state.lastUpsertConflict).toBe(
      "user_id,client_session_id",
    );
    // finished_at on the shared session was NOT rewritten on the retry.
    const afterRetrySession = currentSupabase._state.sessions.get(SESSION_ID);
    expect(afterRetrySession?.finished_at).toBe(firstFinishedAt);
  });

  it("rejects invalid sessionId shape", async () => {
    currentSupabase = buildMockSupabase({
      session: buildSession(),
      items: [],
      entries: [],
    });
    const res = await finalizeSharedSession({ sessionId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("invalid_input");
  });

  it("rejects non-owner finalize", async () => {
    currentUserId = COLLAB_ID; // not the session owner
    currentSupabase = buildMockSupabase({
      session: buildSession(),
      items: [],
      entries: [],
    });

    const res = await finalizeSharedSession({ sessionId: SESSION_ID });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("not_owner");
    expect(currentSupabase._state.records).toHaveLength(0);
  });

  it("falls back appetite_budget to 50 when shared session stores null", async () => {
    currentSupabase = buildMockSupabase({
      session: buildSession({ appetite_budget: null }),
      items: [buildItem({ id: "itm-1", ala_carte_value: "5" })],
      entries: [buildEntry({ id: "e1", user_id: OWNER_ID, units: "1" })],
    });
    const res = await finalizeSharedSession({ sessionId: SESSION_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rec = currentSupabase._state.records[0];
    expect(rec.appetite_budget).toBe(50);
  });
});
