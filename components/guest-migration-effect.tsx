"use client";

import { useEffect, useRef, useState } from "react";

import { promoteGuestSessions } from "@/app/actions/migrate";
import { createClient } from "@/lib/supabase/client";
import { useAyceStore } from "@/lib/store";

/**
 * Subscribes to Supabase auth state on the client side.
 * Returns the current user (or null) and tracks null→user transitions.
 */
function useCurrentUser() {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const prevUserRef = useRef<{ id: string } | null>(null);
  const [justSignedIn, setJustSignedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // Seed with current session (may already be signed in on mount).
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) {
        const wasNull = prevUserRef.current === null;
        prevUserRef.current = { id: u.id };
        setUser({ id: u.id });
        if (wasNull) setJustSignedIn(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ? { id: session.user.id } : null;
      const wasNull = prevUserRef.current === null;
      prevUserRef.current = next;
      setUser(next);
      if (wasNull && next) setJustSignedIn(true);
      if (!next) setJustSignedIn(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { user, justSignedIn, clearJustSignedIn: () => setJustSignedIn(false) };
}

export function GuestMigrationEffect() {
  const { user, justSignedIn, clearJustSignedIn } = useCurrentUser();
  const finishedSessions = useAyceStore((s) => s.finishedSessions);
  const removeFinishedSession = useAyceStore((s) => s.removeFinishedSession);
  const hasHydrated = useAyceStore((s) => s._hasHydrated);

  const [banner, setBanner] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!user) return;
    if (!justSignedIn) return;
    if (finishedSessions.length === 0) {
      clearJustSignedIn();
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;

    const sessionsToPromote = [...finishedSessions];

    promoteGuestSessions(sessionsToPromote)
      .then((result) => {
        for (const id of result.promoted) {
          removeFinishedSession(id);
        }

        const imported = result.promoted.length;
        const needPlace = result.skipped.filter(
          (s) => s.reason === "no_place",
        ).length;

        if (imported > 0 || needPlace > 0) {
          const parts: string[] = [];
          if (imported > 0) {
            parts.push(
              `Imported ${imported} meal${imported === 1 ? "" : "s"}.`,
            );
          }
          if (needPlace > 0) {
            parts.push(
              `${needPlace} still need${needPlace === 1 ? "s" : ""} a restaurant picked.`,
            );
          }
          setBanner(parts.join(" "));
          setTimeout(() => setBanner(null), 6000);
        }

        clearJustSignedIn();
      })
      .catch(() => {
        // Network failure — finishedSessions stay in the store.
        // The next mount/sign-in will retry (DB idempotency makes it safe).
        clearJustSignedIn();
      })
      .finally(() => {
        runningRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, user, justSignedIn, finishedSessions.length]);

  if (!banner) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-6xl px-4 py-2 lg:px-8"
    >
      <div className="rounded-full bg-[#191c1f] px-5 py-2.5 text-center text-sm font-medium text-white dark:bg-white dark:text-[#191c1f]">
        {banner}
      </div>
    </div>
  );
}
