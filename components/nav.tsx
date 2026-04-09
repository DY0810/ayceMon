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
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const isEnabled = sessionActive || ALWAYS_ENABLED.has(item.href);
            const baseClasses =
              "inline-flex h-10 min-w-10 items-center justify-center rounded-full px-4 font-[var(--font-display)] text-[0.9375rem] font-medium transition-colors";
            return (
              <li key={item.href}>
                {isEnabled ? (
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      baseClasses,
                      isActive
                        ? "bg-[#f4f4f4] text-[#191c1f] dark:bg-[#262a2e] dark:text-white"
                        : "text-[#505a63] hover:text-[#191c1f] hover:bg-[#f4f4f4] dark:text-[#8d969e] dark:hover:bg-[#262a2e] dark:hover:text-white"
                    )}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className={cn(
                      baseClasses,
                      "cursor-not-allowed text-[#c9c9cd] dark:text-white/20"
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
