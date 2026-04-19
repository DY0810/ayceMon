"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo, Wordmark } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAyceStore } from "@/lib/store";

interface NavUser {
  email: string;
}

interface NavClientProps {
  user: NavUser | null;
  // Server action passed down from NavServer. Invoked via a `<form action>`
  // wrapper so it runs on the server and receives the session cookie.
  // See node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md
  // ("Passing actions as props").
  signOutAction: () => Promise<void>;
}

// Phase 4 (collab-and-quantitative-appetite): `session-finished` gates the
// /result link. Shared-session finishedAt is mirrored into the Zustand
// store by /result itself so the nav doesn't have to mount the polling
// hook on every route (see lib/use-shared-session.ts + app/result/page.tsx).
// Post-plan (2026-04-14):
//  - `no-active-session` hides /setup while a session is in progress, so
//    users can't accidentally start a second session on top of an active
//    one. The /setup page itself redirects to /tracker as a defensive
//    second gate.
//  - `solo-in-session` hides /combos in shared-session mode because the
//    combo optimizer reads the Zustand solo `session` — combos are a
//    solo-only feature until there's a shared-aware optimizer.
type NavVisibility =
  | "always"
  | "in-session"
  | "solo-in-session"
  | "authed"
  | "session-finished"
  | "no-active-session";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly visibility: NavVisibility;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/setup", label: "Setup", visibility: "no-active-session" },
  { href: "/library", label: "Library", visibility: "in-session" },
  { href: "/combos", label: "Combos", visibility: "solo-in-session" },
  { href: "/tracker", label: "Tracker", visibility: "in-session" },
  { href: "/result", label: "Result", visibility: "session-finished" },
  { href: "/history", label: "History", visibility: "authed" },
  { href: "/stats", label: "Stats", visibility: "authed" },
] as const;

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const cleaned = local.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.slice(0, 2).toUpperCase() || "??";
}

export function NavClient({ user, signOutAction }: NavClientProps) {
  const pathname = usePathname();
  const session = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);
  const sharedSessionId = useAyceStore((state) => state.sharedSessionId);
  const sharedSessionFinishedAt = useAyceStore(
    (state) => state.sharedSessionFinishedAt,
  );

  const sessionActive = hasHydrated && session !== null;
  const signedIn = user !== null;
  // `/result` should surface once any active session reaches its finished
  // draft state. Solo: session.finishedAt is set in Zustand by finishMeal().
  // Shared: the mirror is written by /result after its poll resolves so the
  // nav observes the transition without its own poller.
  const sessionFinished =
    hasHydrated &&
    (((session?.finishedAt ?? null) !== null) ||
      (sharedSessionId !== null && sharedSessionFinishedAt !== null));
  // In-progress = any session (solo or shared) whose finishedAt is still
  // null. Gates /setup (can't start a second session mid-meal) and, via
  // `solo-in-session`, /combos (solo-only feature).
  const soloInProgress =
    hasHydrated && session !== null && !session.finishedAt;
  const sharedInProgress =
    hasHydrated &&
    sharedSessionId !== null &&
    sharedSessionFinishedAt === null;
  const anyInProgress = soloInProgress || sharedInProgress;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonId = useId();
  const menuPanelId = useId();

  useEffect(() => {
    if (!menuOpen) return;

    function onClick(event: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function isVisible(item: NavItem): boolean {
    switch (item.visibility) {
      case "always":
        return true;
      case "in-session":
        return sessionActive || signedIn;
      case "solo-in-session":
        // Visible only when there's a solo (non-shared) active session.
        // Hidden during shared/invite mode because /combos reads the
        // Zustand solo session, which isn't populated for shared flows.
        return soloInProgress && sharedSessionId === null;
      case "authed":
        return signedIn;
      case "session-finished":
        return sessionFinished;
      case "no-active-session":
        // Setup is hidden whenever a session is in progress so users
        // can't start a second one on top. Pre-hydration we keep it
        // visible to avoid flashing the link off on first paint.
        return !hasHydrated || !anyInProgress;
      default: {
        // Exhaustiveness guard — TypeScript errors here if a new
        // NavVisibility variant is added without a matching case above.
        const _exhaustive: never = item.visibility;
        return _exhaustive;
      }
    }
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 lg:px-8"
      >
        <Link
          href="/"
          aria-label="ayceMon home"
          className="mr-4 flex items-center text-foreground"
        >
          <Logo className="size-6" />
          <Wordmark className="ml-2 text-base" />
        </Link>
        <ul className="flex flex-1 items-center justify-end gap-1">
          {NAV_ITEMS.filter(isVisible).map((item) => {
            const isActive = pathname === item.href;
            const baseClasses =
              "inline-flex h-10 min-w-10 items-center justify-center rounded-full px-4 font-[var(--font-display)] text-[0.9375rem] font-medium transition-colors";
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    baseClasses,
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li className="ml-1">
            {signedIn ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  id={menuButtonId}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls={menuPanelId}
                  onClick={() => setMenuOpen((v) => !v)}
                  className="inline-flex size-10 items-center justify-center rounded-full bg-foreground font-[var(--font-display)] text-xs font-semibold tracking-wide text-background transition-opacity hover:opacity-85"
                >
                  <span aria-hidden="true">{initialsFromEmail(user.email)}</span>
                  <span className="sr-only">Account menu for {user.email}</span>
                </button>
                {menuOpen ? (
                  <div
                    id={menuPanelId}
                    role="menu"
                    aria-labelledby={menuButtonId}
                    className="absolute right-0 mt-2 w-56 overflow-hidden rounded-[16px] border border-border bg-popover py-2 shadow-lg"
                  >
                    <div
                      className="px-4 py-2 text-xs text-muted-foreground"
                      aria-hidden="true"
                    >
                      Signed in as
                      <div className="truncate text-sm font-medium text-foreground">
                        {user.email}
                      </div>
                    </div>
                    <div className="my-1 h-px bg-border" />
                    <form action={signOutAction} role="none">
                      <button
                        type="submit"
                        role="menuitem"
                        className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-secondary"
                      >
                        Sign out
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>
            ) : (
              <Link
                href="/login"
                aria-current={pathname === "/login" ? "page" : undefined}
                className={buttonVariants({ variant: "default", size: "default" })}
              >
                Log in
              </Link>
            )}
          </li>
        </ul>
      </nav>
    </header>
  );
}
