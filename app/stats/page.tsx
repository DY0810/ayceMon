import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/require-user";
import { getUserStats, getRestaurantStats } from "@/lib/db/stats";

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

export default async function StatsPage() {
  const { supabase } = await requireUser();
  const [userStats, restaurantStats] = await Promise.all([
    getUserStats(supabase),
    getRestaurantStats(supabase),
  ]);

  if (!userStats || userStats.totalSessions === 0) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
        <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-[#191c1f] lg:text-6xl dark:text-white">
          Stats
        </h1>
        <div className="mt-10 flex flex-col items-center justify-center rounded-[20px] border border-dashed border-[rgba(25,28,31,0.12)] bg-[#f4f4f4] px-6 py-16 text-center dark:border-white/10 dark:bg-[#262a2e]">
          <p className="font-medium text-[#191c1f] dark:text-white">
            You haven&apos;t logged a meal yet.
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

  const marginPositive = userStats.totalMargin >= 0;
  const bestMarginPositive = userStats.bestMargin >= 0;
  const worstMarginPositive = userStats.worstMargin >= 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 lg:px-8 lg:py-20">
      <h1 className="font-[var(--font-display)] text-4xl font-medium leading-tight tracking-tight text-[#191c1f] lg:text-6xl dark:text-white">
        Stats
      </h1>

      {/* Headline record */}
      <p className="mt-4 text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
        Lifetime record across {userStats.totalSessions}{" "}
        {userStats.totalSessions === 1 ? "session" : "sessions"}.
      </p>

      {/* Top-level stats cards */}
      <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Record */}
        <div className="rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white px-5 py-4 dark:border-white/10 dark:bg-[#191c1f]">
          <p className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
            Record
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#191c1f] dark:text-white">
            {userStats.totalWins}–{userStats.totalLosses}
          </p>
        </div>

        {/* Lifetime Margin */}
        <div className="rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white px-5 py-4 dark:border-white/10 dark:bg-[#191c1f]">
          <p className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
            Lifetime Margin
          </p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              marginPositive
                ? "text-[#191c1f] dark:text-white"
                : "text-[#e23b4a]"
            }`}
          >
            {formatMargin(userStats.totalMargin)}
          </p>
        </div>

        {/* Best Run */}
        <div className="rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white px-5 py-4 dark:border-white/10 dark:bg-[#191c1f]">
          <p className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
            Best Run
          </p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              bestMarginPositive
                ? "text-[#191c1f] dark:text-white"
                : "text-[#e23b4a]"
            }`}
          >
            {formatMargin(userStats.bestMargin)}
          </p>
        </div>

        {/* Worst Run */}
        <div className="rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white px-5 py-4 dark:border-white/10 dark:bg-[#191c1f]">
          <p className="text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
            Worst Run
          </p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              worstMarginPositive
                ? "text-[#191c1f] dark:text-white"
                : "text-[#e23b4a]"
            }`}
          >
            {formatMargin(userStats.worstMargin)}
          </p>
        </div>
      </div>

      {/* Per-restaurant table */}
      {restaurantStats.length > 0 && (
        <section className="mt-12">
          <h2 className="font-[var(--font-display)] text-xl font-medium tracking-tight text-[#191c1f] dark:text-white">
            By Restaurant
          </h2>

          {/* Desktop table */}
          <div className="mt-6 hidden lg:block">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left font-[var(--font-display)] text-xs font-medium text-[#505a63] dark:text-[#8d969e]">
                  <th scope="col" className="w-auto py-3 pr-4 font-medium">
                    Name
                  </th>
                  <th scope="col" className="w-20 py-3 px-4 text-right font-medium">
                    Visits
                  </th>
                  <th scope="col" className="w-24 py-3 px-4 text-right font-medium">
                    W–L
                  </th>
                  <th scope="col" className="w-28 py-3 px-4 text-right font-medium">
                    Total Margin
                  </th>
                  <th scope="col" className="w-32 py-3 pl-4 text-right font-medium">
                    Last Visited
                  </th>
                </tr>
              </thead>
              <tbody>
                {restaurantStats.map((rs) => {
                  const rsMarginPositive = rs.totalMargin >= 0;
                  return (
                    <tr
                      key={rs.restaurantId}
                      className="border-t border-[rgba(25,28,31,0.08)] dark:border-white/10"
                    >
                      <td className="py-3 pr-4">
                        <Link
                          href={`/history/by-restaurant/${rs.restaurantId}`}
                          className="font-medium text-[#191c1f] hover:underline dark:text-white"
                        >
                          {rs.restaurantName}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-right text-[#191c1f] dark:text-white">
                        {rs.sessions}
                      </td>
                      <td className="py-3 px-4 text-right text-[#191c1f] dark:text-white">
                        {rs.wins}–{rs.losses}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-semibold ${
                          rsMarginPositive
                            ? "text-[#191c1f] dark:text-white"
                            : "text-[#e23b4a]"
                        }`}
                      >
                        {formatMargin(rs.totalMargin)}
                      </td>
                      <td className="py-3 pl-4 text-right text-[#505a63] dark:text-[#8d969e]">
                        {formatDate(rs.lastVisitedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="mt-4 flex flex-col gap-3 lg:hidden">
            {restaurantStats.map((rs) => {
              const rsMarginPositive = rs.totalMargin >= 0;
              return (
                <li key={rs.restaurantId}>
                  <Link
                    href={`/history/by-restaurant/${rs.restaurantId}`}
                    className="block rounded-[20px] border border-[rgba(25,28,31,0.08)] bg-white px-5 py-4 transition-colors hover:border-[#191c1f] focus-visible:border-[#191c1f] focus-visible:outline-none dark:border-white/10 dark:bg-[#191c1f] dark:hover:border-white dark:focus-visible:border-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="truncate text-base font-semibold text-[#191c1f] dark:text-white">
                        {rs.restaurantName}
                      </p>
                      <span className="shrink-0 text-xs tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
                        {formatDate(rs.lastVisitedAt)}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-3 text-xs tabular-nums">
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-[#505a63] dark:text-[#8d969e]">
                          Visits
                        </dt>
                        <dd className="font-medium text-[#191c1f] dark:text-white">
                          {rs.sessions}
                        </dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-[#505a63] dark:text-[#8d969e]">W–L</dt>
                        <dd className="font-medium text-[#191c1f] dark:text-white">
                          {rs.wins}–{rs.losses}
                        </dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-[#505a63] dark:text-[#8d969e]">
                          Margin
                        </dt>
                        <dd
                          className={`font-semibold ${
                            rsMarginPositive
                              ? "text-[#191c1f] dark:text-white"
                              : "text-[#e23b4a]"
                          }`}
                        >
                          {formatMargin(rs.totalMargin)}
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
