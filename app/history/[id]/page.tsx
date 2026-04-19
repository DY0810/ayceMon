import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/require-user";
import { computeTotals } from "@/lib/calc";
import { UNATTRIBUTED_USER_ID, shortUserId } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import type {
  EatenEntry,
  Item,
  ItemId,
  SessionContributor,
} from "@/lib/types";

// Threshold for the "right on the line" headline (mirrors /result).
const LINE_EPSILON = 0.5;

interface DetailRow {
  id: string;
  buffet_price: number;
  total_eaten_value: number;
  margin: number;
  won: boolean;
  started_at: string;
  finished_at: string;
  library: Item[];
  eaten: EatenEntry[];
  contributors: SessionContributor[];
  client_session_id: string;
  restaurant_name: string | null;
  restaurants: { name: string; formatted_address: string } | null;
}

interface BreakdownRow {
  itemId: ItemId;
  name: string;
  units: number;
  perUnitValue: number;
  lineTotal: number;
}

// Phase 7: a user-scoped block of the breakdown table. `rows` is the
// usual flat rows; `subtotal` is the dollar total for that user.
interface UserGroup {
  userId: string;
  displayName: string;
  rows: BreakdownRow[];
  subtotal: number;
}

function formatUnits(units: number): string {
  return Number.isInteger(units) ? units.toString() : units.toFixed(1);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface PageProps {
  // Next.js 16: dynamic route params is a Promise
  // (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/page.md).
  params: Promise<{ id: string }>;
}

export default async function HistoryDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from("session_records")
    .select(
      "id, buffet_price, total_eaten_value, margin, won, started_at, finished_at, library, eaten, contributors, client_session_id, restaurant_name, restaurants(name, formatted_address)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // An RLS-filtered row shows up as `data: null` with NO error, so any
    // non-null error here is a real failure (bad id shape, network, etc.).
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
        <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-foreground">
          Session
        </h1>
        <p role="alert" className="mt-6 text-sm text-destructive">
          Could not load this session.
        </p>
      </main>
    );
  }

  if (!data) {
    // Zero rows — either the id doesn't exist or it belongs to a different
    // user (RLS blocks the read). Either way: notFound.
    notFound();
  }

  const row = data as unknown as DetailRow;

  // Re-derive the breakdown from the snapshotted library/eaten arrays,
  // skipping dangling ids the same way /result does.
  const itemsById = new Map<ItemId, Item>();
  for (const item of row.library) itemsById.set(item.id, item);

  const rows: BreakdownRow[] = [];
  for (const entry of row.eaten) {
    const item = itemsById.get(entry.itemId);
    if (!item) continue;
    rows.push({
      itemId: entry.itemId,
      name: item.name,
      units: entry.units,
      perUnitValue: item.alaCarteValue,
      lineTotal: item.alaCarteValue * entry.units,
    });
  }

  // Phase 7: per-user groups when this was a shared session. The
  // `contributors` jsonb was stamped at finalize time; its emptiness
  // is the flat-vs-grouped gate. We reuse `computeTotals` on each
  // user's slice so the subtotal math stays on the single source of
  // truth (invariant #1).
  const groups: UserGroup[] =
    row.contributors.length > 0
      ? await buildUserGroups(row, itemsById, supabase)
      : [];

  const totalValue = row.total_eaten_value;
  const marginValue = row.margin;
  const buffetPrice = row.buffet_price;
  const won = row.won;
  const onTheLine = Math.abs(marginValue) <= LINE_EPSILON;
  const marginIsPositive = marginValue >= 0;
  const formattedMargin = `${marginIsPositive ? "+" : "−"}$${Math.abs(
    marginValue,
  ).toFixed(2)}`;
  const headline = onTheLine
    ? "Right on the line."
    : won
      ? `You won! +$${marginValue.toFixed(2)}`
      : `Almost — you were $${Math.abs(marginValue).toFixed(2)} short.`;
  const fillPercent =
    buffetPrice > 0 ? Math.min(100, (totalValue / buffetPrice) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
      <section aria-label="Result headline" className="mb-10 lg:mb-14">
        <Link
          href="/history"
          className="text-xs tracking-[0.01em] text-muted-foreground hover:underline"
        >
          ← Back to history
        </Link>
        <h1 className="mt-4 font-[var(--font-display)] text-4xl font-medium leading-none tracking-[-0.03em] text-foreground md:text-6xl lg:text-7xl">
          {headline}
        </h1>
        {row.restaurants ? (
          <div className="mt-4">
            <p className="text-base font-medium tracking-[0.01em] text-foreground">
              {row.restaurants.name}
            </p>
            <p className="mt-1 text-sm tracking-[0.01em] text-muted-foreground">
              {row.restaurants.formatted_address}
            </p>
          </div>
        ) : row.restaurant_name ? (
          <p className="mt-4 text-base font-medium tracking-[0.01em] text-foreground">
            {row.restaurant_name}
          </p>
        ) : null}
        <p className="mt-2 text-xs tracking-[0.01em] text-muted-foreground">
          Finished {formatDateTime(row.finished_at)}
        </p>
      </section>

      {rows.length > 0 ? (
        <div
          aria-label="Eaten vs buffet price"
          className="mb-8 hidden lg:block"
        >
          <div className="relative h-12 w-full overflow-hidden rounded-full bg-secondary lg:h-16">
            <div
              className="h-full bg-foreground"
              style={{ width: `${fillPercent}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm tracking-[0.01em] tabular-nums text-muted-foreground">
            <span>${totalValue.toFixed(2)} eaten</span>
            <span>of ${buffetPrice.toFixed(2)} buffet</span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10">
        <Card className="order-2 mb-0 hidden lg:order-1 lg:flex">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex w-full flex-col text-sm tabular-nums lg:text-base">
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-[rgba(25,28,31,0.08)] lg:py-4 lg:first:border-t-0 dark:lg:border-white/10">
                <dt className="tracking-[0.01em] text-muted-foreground">
                  Total eaten
                </dt>
                <dd className="font-medium text-foreground">
                  ${totalValue.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-[rgba(25,28,31,0.08)] lg:py-4 dark:lg:border-white/10">
                <dt className="tracking-[0.01em] text-muted-foreground">
                  Buffet price
                </dt>
                <dd className="font-medium text-foreground">
                  ${buffetPrice.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-[rgba(25,28,31,0.08)] lg:py-4 dark:lg:border-white/10">
                <dt className="tracking-[0.01em] text-muted-foreground">
                  Margin
                </dt>
                <dd
                  className={`font-semibold ${
                    !onTheLine && !marginIsPositive
                      ? "text-destructive"
                      : "text-foreground"
                  }`}
                >
                  {formattedMargin}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="order-1 lg:order-2">
          <CardHeader>
            <CardTitle>Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm tracking-[0.01em] text-muted-foreground">
                Nothing was logged during this meal.
              </p>
            ) : groups.length > 0 ? (
              <div className="flex flex-col gap-6">
                {groups.map((g) => (
                  <section
                    key={g.userId}
                    aria-label={`Logged by ${g.displayName}`}
                  >
                    <header className="flex items-baseline justify-between gap-2 pb-2">
                      <h3 className="font-[var(--font-display)] text-sm font-medium tracking-[0.01em] text-foreground lg:text-base">
                        {g.displayName}
                      </h3>
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        ${g.subtotal.toFixed(2)}
                      </span>
                    </header>
                    <BreakdownTable rows={g.rows} />
                  </section>
                ))}
              </div>
            ) : (
              <BreakdownTable rows={rows} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10 flex flex-col gap-3 lg:hidden">
        <dl className="flex w-full flex-col gap-2 text-sm tabular-nums">
          <div className="flex items-center justify-between gap-2">
            <dt className="tracking-[0.01em] text-muted-foreground">
              Total eaten
            </dt>
            <dd className="font-medium text-foreground">
              ${totalValue.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="tracking-[0.01em] text-muted-foreground">
              Buffet price
            </dt>
            <dd className="font-medium text-foreground">
              ${buffetPrice.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="tracking-[0.01em] text-muted-foreground">
              Margin
            </dt>
            <dd
              className={`font-semibold ${
                !onTheLine && !marginIsPositive
                  ? "text-destructive"
                  : "text-foreground"
              }`}
            >
              {formattedMargin}
            </dd>
          </div>
        </dl>
      </div>
    </main>
  );
}

// Phase 7: pulled out of the JSX so grouped + flat renders share the
// same table markup. Rendering one table per group keeps the visual
// rhythm consistent with the existing design.
function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  return (
    <table className="w-full table-fixed text-sm tabular-nums lg:text-base">
      <thead>
        <tr className="text-left font-[var(--font-display)] text-xs font-medium text-muted-foreground lg:text-sm">
          <th scope="col" className="w-auto py-2 pr-2 font-medium">
            Item
          </th>
          <th scope="col" className="w-12 py-2 px-2 text-right font-medium">
            Units
          </th>
          <th scope="col" className="w-16 py-2 px-2 text-right font-medium">
            Per unit
          </th>
          <th scope="col" className="w-20 py-2 pl-2 text-right font-medium">
            Line total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={`${r.itemId}-${i}`}
            className="border-t border-[rgba(25,28,31,0.08)] dark:border-white/10"
          >
            <td className="py-2.5 pr-2 text-foreground break-words lg:py-3">
              {r.name}
            </td>
            <td className="py-2.5 px-2 text-right text-foreground lg:py-3">
              {formatUnits(r.units)}
            </td>
            <td className="py-2.5 px-2 text-right text-muted-foreground lg:py-3">
              ${r.perUnitValue.toFixed(2)}
            </td>
            <td className="py-2.5 pl-2 text-right font-medium text-foreground lg:py-3">
              ${r.lineTotal.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Phase 7: build per-user groups from `row.eaten`. Each entry carries
// `userId` (stamped by finalizeSharedSession). Entries without a
// userId — e.g. on a legacy shared session finalized before Phase 7 —
// fall into a single "Unattributed" group so nothing disappears.
//
// Display names come from the SECURITY DEFINER RPC added in 0006, which
// joins auth.users on user_id and returns the email local-part. The
// RPC is gated on session membership, so non-members cannot enumerate
// other users' emails via /history/[id] either.
async function buildUserGroups(
  row: DetailRow,
  itemsById: Map<ItemId, Item>,
  supabase: SupabaseClient<Database>,
): Promise<UserGroup[]> {
  const namesResult = await supabase.rpc(
    "get_shared_session_collaborator_names",
    { p_session_id: row.client_session_id },
  );
  const nameByUserId = new Map<string, string>();
  // An RPC error here isn't fatal — the grouped UI degrades to the
  // shortUserId fallback (uuid first-8) so the page still renders. We
  // log it instead of throwing so /history/[id] never 500s on a stale
  // contributors jsonb.
  if (namesResult.error) {
    console.warn(
      "get_shared_session_collaborator_names failed; falling back to short ids",
      namesResult.error,
    );
  }
  for (const r of namesResult.data ?? []) {
    nameByUserId.set(r.user_id, r.display_name);
  }

  // Partition entries by userId. Order of first appearance is preserved
  // so the groups render consistently across polls/reloads.
  const entriesByUser = new Map<string, EatenEntry[]>();
  for (const entry of row.eaten) {
    const key = entry.userId ?? UNATTRIBUTED_USER_ID;
    const list = entriesByUser.get(key) ?? [];
    list.push(entry);
    entriesByUser.set(key, list);
  }

  const groups: UserGroup[] = [];
  for (const [userId, entries] of entriesByUser) {
    const groupRows: BreakdownRow[] = [];
    for (const entry of entries) {
      const item = itemsById.get(entry.itemId);
      if (!item) continue;
      groupRows.push({
        itemId: entry.itemId,
        name: item.name,
        units: entry.units,
        perUnitValue: item.alaCarteValue,
        lineTotal: item.alaCarteValue * entry.units,
      });
    }
    const { total } = computeTotals(row.library, entries, 0);
    groups.push({
      userId,
      displayName:
        userId === UNATTRIBUTED_USER_ID
          ? "Unattributed"
          : (nameByUserId.get(userId) ?? shortUserId(userId)),
      rows: groupRows,
      subtotal: total,
    });
  }

  // Push "Unattributed" to the end; everyone else sorted by display
  // name so the rendered order is stable and predictable.
  groups.sort((a, b) => {
    if (a.userId === UNATTRIBUTED_USER_ID) return 1;
    if (b.userId === UNATTRIBUTED_USER_ID) return -1;
    return a.displayName.localeCompare(b.displayName);
  });

  return groups;
}
