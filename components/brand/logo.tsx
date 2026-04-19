import Image from "next/image";

import { cn } from "@/lib/utils";

// The brand mark. Sourced from /public/logo.png (534×552 RGBA with alpha).
// `size-6` is the default so the nav/header sizing stays 24px; callers can
// override via className. `object-contain` preserves the ~0.967 aspect
// ratio inside whatever square the className imposes.
export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={48}
      height={48}
      priority
      className={cn("size-6 object-contain", className)}
    />
  );
}

// The wordmark — "ayce" in ink + "Mon" in accent-ink (AAA on both themes).
// The outer span carries the shared font/letter-spacing so the inner accent
// span only overrides color.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-[var(--font-display)] font-medium tracking-[-0.02em]",
        className,
      )}
    >
      ayce<span className="text-[color:var(--accent-ink)]">Mon</span>
    </span>
  );
}
