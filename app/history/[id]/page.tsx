import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/require-user";
import type { EatenEntry, Item, ItemId } from "@/lib/types";

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
      "id, buffet_price, total_eaten_value, margin, won, started_at, finished_at, library, eaten, restaurant_name, restaurants(name, formatted_address)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // An RLS-filtered row shows up as `data: null` with NO error, so any
    // non-null error here is a real failure (bad id shape, network, etc.).
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
        <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-[#191c1f] dark:text-white">
          Session
        </h1>
        <p role="alert" className="mt-6 text-sm text-[#e23b4a]">
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
          className="text-xs tracking-[0.01em] text-[#505a63] hover:underline dark:text-[#8d969e]"
        >
          ← Back to history
        </Link>
        <h1 className="mt-4 font-[var(--font-display)] text-4xl font-medium leading-none tracking-[-0.03em] text-[#191c1f] md:text-6xl lg:text-7xl dark:text-white">
          {headline}
        </h1>
        {row.restaurants ? (
          <div className="mt-4">
            <p className="text-base font-medium tracking-[0.01em] text-[#191c1f] dark:text-white">
              {row.restaurants.name}
            </p>
            <p className="mt-1 text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
              {row.restaurants.formatted_address}
            </p>
          </div>
        ) : row.restaurant_name ? (
          <p className="mt-4 text-base font-medium tracking-[0.01em] text-[#191c1f] dark:text-white">
            {row.restaurant_name}
          </p>
        ) : null}
        <p className="mt-2 text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
          Finished {formatDateTime(row.finished_at)}
        </p>
      </section>

      {rows.length > 0 ? (
        <div
          aria-label="Eaten vs buffet price"
          className="mb-8 hidden lg:block"
        >
          <div className="relative h-12 w-full overflow-hidden rounded-full bg-[#f4f4f4] lg:h-16 dark:bg-[#262a2e]">
            <div
              className="h-full bg-[#191c1f] dark:bg-white"
              style={{ width: `${fillPercent}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm tracking-[0.01em] tabular-nums text-[#505a63] dark:text-[#8d969e]">
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
                <dt className="tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                  Total eaten
                </dt>
                <dd className="font-medium text-[#191c1f] dark:text-white">
                  ${totalValue.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-[rgba(25,28,31,0.08)] lg:py-4 dark:lg:border-white/10">
                <dt className="tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                  Buffet price
                </dt>
                <dd className="font-medium text-[#191c1f] dark:text-white">
                  ${buffetPrice.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 lg:border-t lg:border-[rgba(25,28,31,0.08)] lg:py-4 dark:lg:border-white/10">
                <dt className="tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                  Margin
                </dt>
                <dd
                  className={`font-semibold ${
                    !onTheLine && !marginIsPositive
                      ? "text-[#e23b4a]"
                      : "text-[#191c1f] dark:text-white"
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
              <p className="text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                Nothing was logged during this meal.
              </p>
            ) : (
              <table className="w-full table-fixed text-sm tabular-nums lg:text-base">
                <thead>
                  <tr className="text-left font-[var(--font-display)] text-xs font-medium text-[#505a63] lg:text-sm dark:text-[#8d969e]">
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
                  {rows.map((r) => (
                    <tr
                      key={r.itemId}
                      className="border-t border-[rgba(25,28,31,0.08)] dark:border-white/10"
                    >
                      <td className="py-2.5 pr-2 text-[#191c1f] break-words lg:py-3 dark:text-white">
                        {r.name}
                      </td>
                      <td className="py-2.5 px-2 text-right text-[#191c1f] lg:py-3 dark:text-white">
                        {formatUnits(r.units)}
                      </td>
                      <td className="py-2.5 px-2 text-right text-[#505a63] lg:py-3 dark:text-[#8d969e]">
                        ${r.perUnitValue.toFixed(2)}
                      </td>
                      <td className="py-2.5 pl-2 text-right font-medium text-[#191c1f] lg:py-3 dark:text-white">
                        ${r.lineTotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10 flex flex-col gap-3 lg:hidden">
        <dl className="flex w-full flex-col gap-2 text-sm tabular-nums">
          <div className="flex items-center justify-between gap-2">
            <dt className="tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
              Total eaten
            </dt>
            <dd className="font-medium text-[#191c1f] dark:text-white">
              ${totalValue.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
              Buffet price
            </dt>
            <dd className="font-medium text-[#191c1f] dark:text-white">
              ${buffetPrice.toFixed(2)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
              Margin
            </dt>
            <dd
              className={`font-semibold ${
                !onTheLine && !marginIsPositive
                  ? "text-[#e23b4a]"
                  : "text-[#191c1f] dark:text-white"
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
