import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/require-user";

const PAGE_SIZE = 20;

interface HistoryRow {
  id: string;
  finished_at: string;
  buffet_price: number;
  total_eaten_value: number;
  margin: number;
  won: boolean;
  restaurant_name: string | null;
  restaurants: { name: string; formatted_address: string } | null;
}

function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatMargin(n: number): string {
  const positive = n >= 0;
  return `${positive ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
}

function formatDate(iso: string): string {
  // Match the existing terse formatting used elsewhere in the app. The
  // locale is left undefined so the browser picks it up from the user's
  // system; server renders resolve to en-US by default which is fine for
  // this app's current audience.
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface PageProps {
  // Next.js 16: searchParams is a Promise (see
  // node_modules/next/dist/docs/01-app/03-api-reference/04-functions/page.md).
  searchParams: Promise<{ page?: string }>;
}

export default async function HistoryPage({ searchParams }: PageProps) {
  const { supabase } = await requireUser();
  const params = await searchParams;
  const rawPage = Number.parseInt(params.page ?? "0", 10);
  const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from("session_records")
    .select(
      "id, finished_at, buffet_price, total_eaten_value, margin, won, restaurant_name, restaurants(name, formatted_address)",
    )
    .order("finished_at", { ascending: false })
    .range(from, to);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
        <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-[#191c1f] dark:text-white">
          History
        </h1>
        <p role="alert" className="mt-6 text-sm text-[#e23b4a]">
          Could not load your history. Please refresh and try again.
        </p>
      </main>
    );
  }

  const rows = (data ?? []) as unknown as HistoryRow[];
  const hasNext = rows.length === PAGE_SIZE;
  const hasPrev = page > 0;

  if (rows.length === 0 && page === 0) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
        <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-[#191c1f] lg:text-6xl dark:text-white">
          History
        </h1>
        <div className="mt-10 flex flex-col items-center justify-center rounded-[20px] border border-dashed border-[rgba(25,28,31,0.12)] bg-[#f4f4f4] px-6 py-16 text-center dark:border-white/10 dark:bg-[#262a2e]">
          <p className="font-medium text-[#191c1f] dark:text-white">
            No meals logged yet.
          </p>
          <p className="mt-2 text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
            Start a session to track your first W.
          </p>
          <Link
            href="/setup"
            className={buttonVariants({ variant: "outline", className: "mt-6" })}
          >
            Start a session
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
      <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-[#191c1f] lg:text-6xl dark:text-white">
        History
      </h1>
      <p className="mt-4 text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
        Your most recent buffet sessions, newest first.
      </p>

      <ul className="mt-10 flex flex-col gap-3">
        {rows.map((row) => {
          const marginPositive = row.margin >= 0;
          return (
            <li key={row.id}>
              <Link
                href={`/history/${row.id}`}
                className="block rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white px-5 py-4 transition-colors hover:border-[#191c1f] focus-visible:border-[#191c1f] focus-visible:outline-none dark:border-white/10 dark:bg-[#191c1f] dark:hover:border-white dark:focus-visible:border-white"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[#191c1f] dark:text-white">
                      {row.restaurants?.name ?? row.restaurant_name ?? "Unnamed restaurant"}
                    </p>
                    <p className="mt-1 text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                      {formatDate(row.finished_at)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.01em] ${
                      row.won
                        ? "bg-[#191c1f] text-white dark:bg-white dark:text-[#191c1f]"
                        : "bg-[#fde5e8] text-[#e23b4a] dark:bg-[#3a1a1d] dark:text-[#ff8694]"
                    }`}
                  >
                    {row.won ? "Won" : "Lost"}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-xs tabular-nums">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[#505a63] dark:text-[#8d969e]">Buffet</dt>
                    <dd className="font-medium text-[#191c1f] dark:text-white">
                      {formatCurrency(row.buffet_price)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[#505a63] dark:text-[#8d969e]">Eaten</dt>
                    <dd className="font-medium text-[#191c1f] dark:text-white">
                      {formatCurrency(row.total_eaten_value)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-[#505a63] dark:text-[#8d969e]">Margin</dt>
                    <dd
                      className={`font-semibold ${
                        marginPositive
                          ? "text-[#191c1f] dark:text-white"
                          : "text-[#e23b4a]"
                      }`}
                    >
                      {formatMargin(row.margin)}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>

      {(hasPrev || hasNext) && (
        <nav
          className="mt-10 flex items-center justify-between"
          aria-label="History pagination"
        >
          {hasPrev ? (
            <Link
              href={`/history?page=${page - 1}`}
              className={buttonVariants({ variant: "outline" })}
            >
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link
              href={`/history?page=${page + 1}`}
              className={buttonVariants({ variant: "outline" })}
            >
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
