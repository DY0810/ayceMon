import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/require-user";
import {
  getRestaurantById,
  getSessionsAtRestaurant,
} from "@/lib/db/stats";

function formatCurrency(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}

function formatMargin(n: number): string {
  const positive = n >= 0;
  return `${positive ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface PageProps {
  // Next.js 16: dynamic route params is a Promise
  // (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/page.md).
  params: Promise<{ restaurantId: string }>;
}

export default async function ByRestaurantPage({ params }: PageProps) {
  const { restaurantId } = await params;
  const { supabase } = await requireUser();

  const [restaurant, sessions] = await Promise.all([
    getRestaurantById(supabase, restaurantId),
    getSessionsAtRestaurant(supabase, restaurantId),
  ]);

  // No restaurant found or user has zero sessions there — treat as 404.
  if (!restaurant || sessions.length === 0) {
    notFound();
  }

  const wins = sessions.filter((s) => s.won).length;
  const losses = sessions.length - wins;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
      <Link
        href="/stats"
        className="text-xs tracking-[0.01em] text-muted-foreground hover:underline"
      >
        ← Back to stats
      </Link>

      {/* Header */}
      <h1 className="mt-4 font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-foreground lg:text-6xl">
        {restaurant.name}
      </h1>
      <p className="mt-2 text-sm tracking-[0.01em] text-muted-foreground">
        {restaurant.formattedAddress}
      </p>

      {/* W-L badge */}
      <div className="mt-6 flex items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-foreground px-4 py-1.5 text-sm font-semibold tabular-nums text-background">
          {wins}–{losses}
        </span>
        <span className="text-sm tracking-[0.01em] text-muted-foreground">
          across {sessions.length} {sessions.length === 1 ? "visit" : "visits"}
        </span>
      </div>

      {/* Sessions list */}
      <ul className="mt-10 flex flex-col gap-3">
        {sessions.map((session) => {
          const marginPositive = session.margin >= 0;
          return (
            <li key={session.id}>
              <Link
                href={`/history/${session.id}`}
                className="block rounded-[20px] border border-border bg-card px-5 py-4 transition-colors hover:border-foreground focus-visible:border-foreground focus-visible:outline-none"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-sm tracking-[0.01em] text-muted-foreground">
                    {formatDate(session.finishedAt)}
                  </p>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.01em] ${
                      session.won
                        ? "bg-foreground text-background"
                        : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {session.won ? "Won" : "Lost"}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-xs tabular-nums">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-muted-foreground">Buffet</dt>
                    <dd className="font-medium text-foreground">
                      {formatCurrency(session.buffetPrice)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-muted-foreground">Eaten</dt>
                    <dd className="font-medium text-foreground">
                      {formatCurrency(session.totalEatenValue)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-muted-foreground">Margin</dt>
                    <dd
                      className={`font-semibold ${
                        marginPositive
                          ? "text-foreground"
                          : "text-destructive"
                      }`}
                    >
                      {formatMargin(session.margin)}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
