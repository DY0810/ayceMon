"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import {
  joinSharedSession,
  type JoinSharedSessionError,
} from "@/app/actions/shared-session";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { useAyceStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Phase 7: client-side /join redemption. Reads the `token` query
// parameter, redirects unauthenticated users to /login (round-tripping
// via `?next=`), and otherwise calls the server action.
//
// `useSearchParams` is read here (inside the Suspense boundary set up
// by app/join/page.tsx) so prerendering works correctly. See
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md
// §"Behavior → Prerendering" (lines 80–179).

type JoinState =
  | { status: "idle" }
  | { status: "joining" }
  | { status: "success"; sessionId: string }
  | { status: "error"; code: JoinErrorCode };

// Client-visible error union = every server-side error code, plus the
// one UI-only "missing_token" state we surface before we even call the
// action. `JoinSharedSessionError` is re-exported from the server-only
// action module as a string union (types are erased at runtime, so no
// server code follows the import into the client bundle). Adding a new
// server code here triggers a compile error everywhere it's handled —
// that's the guardrail a `as JoinErrorCode` cast wouldn't give us.
type JoinErrorCode = JoinSharedSessionError | "missing_token";

export function JoinClient() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const setSharedSessionId = useAyceStore((s) => s.setSharedSessionId);

  // Internal run state — drives the async redemption only. Terminal UI
  // reads `state.status` ("idle" means the effect hasn't finished yet).
  const [state, setState] = useState<JoinState>({ status: "idle" });

  useEffect(() => {
    // Bail out of the effect when no token is present — the derived
    // render path below surfaces the "missing_token" error without a
    // synchronous setState-in-effect (eslint rule set-state-in-effect).
    if (!token) return;

    let cancelled = false;

    (async () => {
      // Check auth client-side first so unauthenticated visitors bounce
      // to /login with a `next` param that preserves the invite URL.
      // The server action also enforces auth (requireUser) — this is
      // just for UX so the join request doesn't round-trip a redirect.
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        const next = encodeURIComponent(`/join?token=${token}`);
        router.replace(`/login?next=${next}`);
        return;
      }

      setState({ status: "joining" });
      const result = await joinSharedSession(token);
      if (cancelled) return;

      if (!result.ok) {
        // The server action types its error as a plain `string` in
        // ActionResult<T>, but joinSharedSession only ever returns codes
        // from `JoinSharedSessionError`. Cast through the shared type so
        // TS stays in sync; unknown strings fall through to join_failed
        // in describeError() anyway.
        setState({
          status: "error",
          code: result.error as JoinSharedSessionError,
        });
        return;
      }

      setSharedSessionId(result.data.sessionId);
      setState({ status: "success", sessionId: result.data.sessionId });
      router.replace("/tracker");
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router, setSharedSessionId]);

  // Missing-token state is derived at render time (cheap, deterministic,
  // no setState required). Every other terminal state flows through
  // `state` which the effect updates after awaits.
  if (!token) {
    return <JoinError code="missing_token" />;
  }

  if (state.status === "idle" || state.status === "joining") {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-20 text-center">
        <p
          className="text-sm tracking-[0.01em] text-muted-foreground"
          aria-live="polite"
        >
          Joining session…
        </p>
      </main>
    );
  }

  if (state.status === "success") {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-20 text-center">
        <p
          className="text-sm tracking-[0.01em] text-muted-foreground"
          aria-live="polite"
        >
          You&apos;re in. Taking you to the tracker…
        </p>
      </main>
    );
  }

  return <JoinError code={state.code} />;
}

function JoinError({ code }: { code: JoinErrorCode }) {
  const { headline, body, cta } = describeError(code);
  return (
    <main className="mx-auto w-full max-w-md px-4 py-20">
      <Card>
        <CardHeader>
          <CardTitle>{headline}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm tracking-[0.01em] text-muted-foreground">
            {body}
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href={cta.href}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              {cta.label}
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

interface ErrorCopy {
  headline: string;
  body: string;
  cta: { href: string; label: string };
}

function describeError(code: JoinErrorCode): ErrorCopy {
  switch (code) {
    case "missing_token":
      return {
        headline: "No invite token",
        body: "This link is missing the invite token. Ask the session owner for a fresh link.",
        cta: { href: "/", label: "Back to home" },
      };
    case "invite_expired":
      return {
        headline: "Invite expired",
        body: "This invite has expired. Ask the session owner for a fresh link.",
        cta: { href: "/", label: "Back to home" },
      };
    case "invite_already_used":
      return {
        headline: "Invite already used",
        body: "This invite has already been redeemed. Ask the session owner for a fresh link.",
        cta: { href: "/", label: "Back to home" },
      };
    case "session_finalized":
      return {
        headline: "Session already finished",
        body: "The owner has already closed this meal. Start your own session instead.",
        cta: { href: "/setup", label: "Start a session" },
      };
    case "rate_limited":
      return {
        headline: "Too many joins",
        body: "Too many joins from this network — try again in an hour.",
        cta: { href: "/", label: "Back to home" },
      };
    case "invite_not_found":
      return {
        headline: "Invite not found",
        body: "We couldn't find this invite. Ask the session owner for a fresh link.",
        cta: { href: "/", label: "Back to home" },
      };
    case "invalid_input":
    case "join_failed":
    default:
      return {
        headline: "Couldn't join session",
        body: "Something went wrong joining this session. Try again in a moment.",
        cta: { href: "/", label: "Back to home" },
      };
  }
}
