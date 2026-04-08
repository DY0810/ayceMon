"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useAyceStore } from "@/lib/store";

const NAV_ITEMS = [
  { href: "/setup", label: "Setup" },
  { href: "/library", label: "Library" },
  { href: "/combos", label: "Combos" },
  { href: "/tracker", label: "Tracker" },
  { href: "/result", label: "Result" },
] as const;

// Routes that should always be enabled, even with no active session.
const ALWAYS_ENABLED = new Set<string>(["/setup"]);

export function Nav() {
  const pathname = usePathname();
  const session = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);

  // Until hydrated, treat as no-session to avoid SSR/CSR mismatch.
  const sessionActive = hasHydrated && session !== null;

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-3 lg:px-6"
      >
        <Link
          href="/"
          className="font-heading mr-2 text-base font-semibold tracking-tight"
        >
          ayceMon
        </Link>
        <ul className="flex flex-1 items-center justify-end gap-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const isEnabled = sessionActive || ALWAYS_ENABLED.has(item.href);
            const baseClasses =
              "inline-flex h-11 min-w-11 items-center justify-center rounded-md px-2.5 text-sm font-medium transition-colors";
            return (
              <li key={item.href}>
                {isEnabled ? (
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      baseClasses,
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className={cn(
                      baseClasses,
                      "cursor-not-allowed text-muted-foreground/40"
                    )}
                  >
                    {item.label}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
