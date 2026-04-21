"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatGrams } from "@/lib/format";
import type { LiveContributor } from "@/lib/types";

interface ContributorPanelProps {
  contributors: readonly LiveContributor[];
  buffetPrice: number;
  selfUserId: string | null;
}

export function ContributorPanel({
  contributors,
  buffetPrice,
  selfUserId,
}: ContributorPanelProps) {
  if (contributors.length === 0) return null;

  // Fair-share target is the would-be even split across currently-seated
  // collaborators. This is a live heuristic for "am I eating my share",
  // not an owed-amount calculation — Phase 5 explicitly excludes bill
  // splits (see plan Anti-pattern guards).
  const fairShare =
    buffetPrice > 0 ? buffetPrice / contributors.length : 0;

  return (
    <section
      aria-label="Per-person totals"
      aria-live="polite"
      className="-mx-4 border-b border-border bg-background px-4 py-5 tracking-[0.01em] lg:col-span-3 lg:mx-0 lg:px-0 lg:py-6"
    >
      <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Per-person totals
      </h2>
      <ul
        role="list"
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {contributors.map((c) => {
          const isSelf = selfUserId !== null && c.userId === selfUserId;
          const overShare = fairShare > 0 && c.valueEaten > fairShare;
          const percent =
            fairShare > 0
              ? Math.min(
                  100,
                  Math.max(0, (c.valueEaten / fairShare) * 100),
                )
              : 0;

          return (
            <li key={c.userId}>
              <Card size="sm">
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                      {c.displayName}
                      {isSelf ? (
                        <span className="ml-1 font-normal text-[color:var(--accent-ink)]">
                          (you)
                        </span>
                      ) : null}
                    </p>
                    {overShare ? (
                      <Badge variant="secondary">Over share</Badge>
                    ) : null}
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xl font-semibold tabular-nums text-foreground">
                      ${c.valueEaten.toFixed(2)}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatGrams(c.grams)}
                    </span>
                  </div>
                  <Progress
                    value={percent}
                    aria-label={`Share of fair split for ${c.displayName}`}
                  />
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
