"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

type NavVisibility = "always" | "in-session" | "authed";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly visibility: NavVisibility;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/setup", label: "Setup", visibility: "always" },
  { href: "/library", label: "Library", visibility: "in-session" },
  { href: "/combos", label: "Combos", visibility: "in-session" },
  { href: "/tracker", label: "Tracker", visibility: "in-session" },
  { href: "/result", label: "Result", visibility: "in-session" },
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

  const sessionActive = hasHydrated && session !== null;
  const signedIn = user !== null;

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
      case "authed":
        return signedIn;
    }
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[rgba(25,28,31,0.08)] bg-white dark:border-white/10 dark:bg-[#191c1f]">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 lg:px-8"
      >
        <Link
          href="/"
          className="font-[var(--font-display)] mr-4 text-xl font-medium tracking-tight text-[#191c1f] dark:text-white"
        >
          ayceMon
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
                      ? "bg-[#f4f4f4] text-[#191c1f] dark:bg-[#262a2e] dark:text-white"
                      : "text-[#505a63] hover:text-[#191c1f] hover:bg-[#f4f4f4] dark:text-[#8d969e] dark:hover:bg-[#262a2e] dark:hover:text-white",
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
                  className="inline-flex size-10 items-center justify-center rounded-full bg-[#191c1f] font-[var(--font-display)] text-xs font-semibold tracking-wide text-white transition-opacity hover:opacity-85 dark:bg-white dark:text-[#191c1f]"
                >
                  <span aria-hidden="true">{initialsFromEmail(user.email)}</span>
                  <span className="sr-only">Account menu for {user.email}</span>
                </button>
                {menuOpen ? (
                  <div
                    id={menuPanelId}
                    role="menu"
                    aria-labelledby={menuButtonId}
                    className="absolute right-0 mt-2 w-56 overflow-hidden rounded-[16px] border border-[rgba(25,28,31,0.08)] bg-white py-2 shadow-lg dark:border-white/10 dark:bg-[#191c1f]"
                  >
                    <div
                      className="px-4 py-2 text-xs text-[#505a63] dark:text-[#8d969e]"
                      aria-hidden="true"
                    >
                      Signed in as
                      <div className="truncate text-sm font-medium text-[#191c1f] dark:text-white">
                        {user.email}
                      </div>
                    </div>
                    <div className="my-1 h-px bg-[rgba(25,28,31,0.06)] dark:bg-white/10" />
                    <form action={signOutAction} role="none">
                      <button
                        type="submit"
                        role="menuitem"
                        className="block w-full px-4 py-2 text-left text-sm text-[#191c1f] hover:bg-[#f4f4f4] dark:text-white dark:hover:bg-[#262a2e]"
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
                className="inline-flex h-10 items-center justify-center rounded-full bg-[#191c1f] px-5 font-[var(--font-display)] text-[0.9375rem] font-medium text-white transition-opacity hover:opacity-85 dark:bg-white dark:text-[#191c1f]"
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
