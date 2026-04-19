import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock `server-only` so importing shared-session.ts doesn't throw when
// vitest runs it outside the Next.js server runtime.
vi.mock("server-only", () => ({}));

// listContributors doesn't revalidate paths (read-only endpoint), but the
// sibling exports in the same module do — mock so the import is safe.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const COLLAB_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";

interface SBResponse<T = unknown> {
  data: T;
  error: unknown;
}

type State = {
  items: Array<Record<string, unknown>>;
  entries: Array<Record<string, unknown>>;
  collaborators: Array<Record<string, unknown>>;
  rpcNames: Array<{ user_id: string; display_name: string }>;
  fromCalls: string[];
  rpcCalls: string[];
  itemsError?: unknown;
  entriesError?: unknown;
  collaboratorsError?: unknown;
  rpcError?: unknown;
};

let state: State;

function buildMockSupabase() {
  return {
    from(table: string) {
      state.fromCalls.push(table);
      const ctx = { _eqs: {} as Record<string, unknown> };
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          ctx._eqs[col] = val;
          return builder;
        },
        then(resolve: (r: SBResponse) => void) {
          const sid = ctx._eqs.session_id;
          if (table === "shared_session_items") {
            if (state.itemsError) {
              resolve({ data: null, error: state.itemsError });
              return;
            }
            resolve({
              data: state.items.filter((r) => r.session_id === sid),
              error: null,
            });
            return;
          }
          if (table === "shared_session_entries") {
            if (state.entriesError) {
              resolve({ data: null, error: state.entriesError });
              return;
            }
            resolve({
              data: state.entries.filter((r) => r.session_id === sid),
              error: null,
            });
            return;
          }
          if (table === "shared_session_collaborators") {
            if (state.collaboratorsError) {
              resolve({ data: null, error: state.collaboratorsError });
              return;
            }
            resolve({
              data: state.collaborators.filter((r) => r.session_id === sid),
              error: null,
            });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return builder;
    },
    rpc(name: string) {
      state.rpcCalls.push(name);
      if (state.rpcError) {
        return Promise.resolve({ data: null, error: state.rpcError });
      }
      return Promise.resolve({ data: state.rpcNames, error: null });
    },
  };
}

let currentUserId = OWNER_ID;
let currentSupabase: ReturnType<typeof buildMockSupabase>;
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({
    user: { id: currentUserId },
    supabase: currentSupabase,
  }),
}));

import { listContributors } from "./shared-session";

describe("listContributors", () => {
  beforeEach(() => {
    currentUserId = OWNER_ID;
    state = {
      items: [],
      entries: [],
      collaborators: [],
      rpcNames: [],
      fromCalls: [],
      rpcCalls: [],
    };
    currentSupabase = buildMockSupabase();
  });

  it("rejects malformed UUID without touching the DB", async () => {
    const result = await listContributors("not-a-uuid");
    expect(result).toEqual({ ok: false, error: "invalid_session_id" });
    expect(state.fromCalls).toEqual([]);
    expect(state.rpcCalls).toEqual([]);
  });

  it("happy path: 2 users, 3 items — returns aggregated LiveContributor[]", async () => {
    state.items = [
      {
        session_id: SESSION_ID,
        id: "sushi",
        ala_carte_value: "10",
        grams_per_unit: "100",
      },
      {
        session_id: SESSION_ID,
        id: "steak",
        ala_carte_value: "25",
        grams_per_unit: "200",
      },
      {
        session_id: SESSION_ID,
        id: "ice-cream",
        ala_carte_value: "5",
        grams_per_unit: "50",
      },
    ];
    state.entries = [
      {
        session_id: SESSION_ID,
        user_id: OWNER_ID,
        item_id: "sushi",
        units: "2",
        grams: null,
        logged_at: "2026-04-18T12:00:00Z",
      },
      {
        session_id: SESSION_ID,
        user_id: OWNER_ID,
        item_id: "steak",
        units: "1",
        grams: "250",
        logged_at: "2026-04-18T12:05:00Z",
      },
      {
        session_id: SESSION_ID,
        user_id: COLLAB_ID,
        item_id: "ice-cream",
        units: "3",
        grams: null,
        logged_at: "2026-04-18T12:10:00Z",
      },
    ];
    state.collaborators = [
      { session_id: SESSION_ID, user_id: OWNER_ID, role: "owner" },
      { session_id: SESSION_ID, user_id: COLLAB_ID, role: "collaborator" },
    ];
    state.rpcNames = [
      { user_id: OWNER_ID, display_name: "alice" },
      { user_id: COLLAB_ID, display_name: "bob" },
    ];

    const result = await listContributors(SESSION_ID);
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    expect(result.data).toHaveLength(2);

    const owner = result.data.find((c) => c.userId === OWNER_ID);
    const collab = result.data.find((c) => c.userId === COLLAB_ID);
    if (!owner || !collab) throw new Error("missing row");

    expect(owner.valueEaten).toBe(45);
    expect(owner.grams).toBe(450);
    expect(owner.unitCount).toBe(3);
    expect(owner.role).toBe("owner");
    expect(owner.displayName).toBe("alice");
    expect(owner.lastLoggedAt).toBe("2026-04-18T12:05:00Z");

    expect(collab.valueEaten).toBe(15);
    expect(collab.grams).toBe(150);
    expect(collab.unitCount).toBe(3);
    expect(collab.role).toBe("collaborator");
    expect(collab.displayName).toBe("bob");
  });

  it("empty-entry collaborator still appears as a zero row", async () => {
    state.items = [];
    state.entries = [];
    state.collaborators = [
      { session_id: SESSION_ID, user_id: OWNER_ID, role: "owner" },
    ];
    state.rpcNames = [{ user_id: OWNER_ID, display_name: "alice" }];

    const result = await listContributors(SESSION_ID);
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      userId: OWNER_ID,
      displayName: "alice",
      role: "owner",
      valueEaten: 0,
      grams: 0,
      unitCount: 0,
      lastLoggedAt: null,
    });
  });

  it("surfaces lookup_failed when items query errors", async () => {
    state.itemsError = { message: "boom" };
    state.collaborators = [
      { session_id: SESSION_ID, user_id: OWNER_ID, role: "owner" },
    ];
    const result = await listContributors(SESSION_ID);
    expect(result).toEqual({ ok: false, error: "lookup_failed" });
  });

  it("surfaces lookup_failed when RPC errors", async () => {
    state.rpcError = { message: "rpc boom" };
    state.collaborators = [
      { session_id: SESSION_ID, user_id: OWNER_ID, role: "owner" },
    ];
    const result = await listContributors(SESSION_ID);
    expect(result).toEqual({ ok: false, error: "lookup_failed" });
  });

  it("returns empty array when RLS masks the session (no collaborators)", async () => {
    // RLS strips the collaborator + entry + item rows for a non-member; we
    // should not throw — just return an empty contributor list. The caller
    // decides whether to surface that as a 404 at the REST layer.
    const result = await listContributors(SESSION_ID);
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    expect(result.data).toEqual([]);
  });
});
