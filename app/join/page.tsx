import { Suspense } from "react";

import { JoinClient } from "./join-client";

// Phase 7 (collab-and-quantitative-appetite): invite redemption landing
// page. The client component reads `useSearchParams().get("token")` and
// then calls the `joinSharedSession` server action.
//
// Next 16 requires `useSearchParams()` callers to live inside a
// `<Suspense/>` boundary so the static shell can be prerendered while
// the dynamic search-params tree suspends. Violating this breaks the
// production build with the "Missing Suspense boundary with
// useSearchParams" error.
//
// Reference: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md
// Section "Behavior → Prerendering" (lines 80–179). The canonical
// example wraps `<SearchBar>` in `<Suspense>`; we mirror that shape.

export const metadata = {
  title: "Join session · ayceMon",
};

export default function JoinPage() {
  return (
    <Suspense fallback={<JoinLoading />}>
      <JoinClient />
    </Suspense>
  );
}

function JoinLoading() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-20 text-center">
      <p className="text-sm tracking-[0.01em] text-[#505a63] dark:text-[#8d969e]">
        Joining session…
      </p>
    </main>
  );
}
