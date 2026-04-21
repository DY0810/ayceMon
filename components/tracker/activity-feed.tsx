"use client";

import { useMemo, useState } from "react";

import { formatActivityRelative, formatActivityUnits } from "@/lib/format-activity";
import type { LiveActivityEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

// Phase 6 (multi-user-tracking-k8s-brand): reverse-chronological feed of
// the most recent per-entry events in a shared session. Consumes the
// `activity` field from useSharedSession, which is derived from the same
// 2.5s poll that feeds the contributor panel — no separate ticker. The
// component slices to the latest 20 rows; the hook returns the full set
// so future surfaces can reuse it without a second pass.

const STORAGE_KEY = "ayceMon:activity-feed:collapsed";
const MAX_ROWS = 20;

interface ActivityFeedProps {
  activity: readonly LiveActivityEvent[];
  /** Epoch ms anchor for relative-time labels. Sourced from the shared
   *  session hook's `lastPolledAt` so the value only advances on the
   *  existing 2.5s heartbeat — no second setInterval here, and no
   *  `Date.now()` at render time (forbidden by react-hooks/purity). */
  now: number;
  selfUserId: string | null;
}

export function ActivityFeed({ activity, now, selfUserId }: ActivityFeedProps) {
  // Lazy initializer reads sessionStorage on first mount only (never
  // during subsequent renders), so the react-hooks/purity rule doesn't
  // fire on the impure storage read. `typeof window` guard keeps the
  // SSR path returning `false` to avoid a hydration-mismatch warning
  // when a user's prior session persisted a collapsed state.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // State updaters must be pure under React 19 strict mode (double-invoked
  // to surface impurity), so the sessionStorage write lives in the event
  // handler body alongside `setCollapsed`, not inside the updater. The
  // handler reads the current value via closure; re-rendering on each
  // toggle creates a fresh closure, so the stale-read concern doesn't
  // apply here — we're not deferring across async boundaries.
  function toggle() {
    const next = !collapsed;
    try {
      sessionStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Persistence is best-effort; UI state still updates.
    }
    setCollapsed(next);
  }

  const rows = useMemo(() => activity.slice(0, MAX_ROWS), [activity]);

  return (
    <section
      aria-label="Activity"
      className="-mx-4 border-b border-border bg-background px-4 py-5 tracking-[0.01em] lg:col-span-3 lg:mx-0 lg:px-0 lg:py-6"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Activity
        </h2>
        <button
          type="button"
          className="text-xs font-medium tracking-[0.01em] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-none"
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>
      {collapsed ? null : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No activity yet — be the first to log a bite.
        </p>
      ) : (
        <ul role="list" className="mt-4 flex flex-col gap-px">
          {rows.map((event) => (
            <ActivityRow
              key={event.entryId}
              event={event}
              now={now}
              isSelf={selfUserId !== null && event.userId === selfUserId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ActivityRowProps {
  event: LiveActivityEvent;
  now: number;
  isSelf: boolean;
}

function ActivityRow({ event, now, isSelf }: ActivityRowProps) {
  return (
    <li
      className={cn(
        "flex items-baseline gap-2 rounded px-2 py-1.5 text-sm",
        isSelf && "bg-[color:var(--accent-subtle)]",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground">{event.displayName}</span>
        <span className="text-muted-foreground">
          {" · "}
          {event.itemName}
        </span>
      </span>
      <span className="flex-shrink-0 tabular-nums text-muted-foreground">
        {formatActivityUnits(event.units, event.grams)}
      </span>
      <span className="flex-shrink-0 tabular-nums text-muted-foreground">
        {formatActivityRelative(event.loggedAt, now)}
      </span>
    </li>
  );
}
