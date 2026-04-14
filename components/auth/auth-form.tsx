"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  mode: AuthMode;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

const COPY = {
  login: {
    heading: "Log in",
    subheading: "Sign in to pick up where you left off.",
    submit: "Log in",
    footer: "Don't have an account?",
    footerLinkLabel: "Sign up",
    footerHref: "/signup",
  },
  signup: {
    heading: "Sign up",
    subheading: "Save your sessions and track wins across every buffet.",
    submit: "Create account",
    footer: "Already have an account?",
    footerLinkLabel: "Log in",
    footerHref: "/login",
  },
} as const;

export function AuthForm({ mode }: AuthFormProps) {
  const copy = COPY[mode];
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!email.trim()) {
      next.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Enter a valid email";
    }
    if (!password) {
      next.password = "Password is required";
    } else if (mode === "signup" && password.length < 8) {
      next.password = "Use at least 8 characters";
    }
    return next;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setInfoMessage(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    startTransition(async () => {
      const supabase = createClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setFormError("Invalid email or password.");
          return;
        }
        router.replace("/");
        router.refresh();
        return;
      }

      // mode === "signup"
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${origin}/auth/confirm`,
        },
      });
      if (error) {
        setFormError("Something went wrong. Please try again.");
        return;
      }
      // If the project requires email confirmation, session is null and the
      // user needs to click the link in their inbox.
      if (!data.session) {
        setInfoMessage(
          "Check your inbox for a confirmation link to finish signing up.",
        );
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 lg:py-24">
      <div className="flex flex-col gap-2">
        <h1 className="font-[var(--font-display)] text-4xl font-medium tracking-[-0.02em] text-[#191c1f] dark:text-white">
          {copy.heading}
        </h1>
        <p className="text-[0.9375rem] text-[#505a63] dark:text-[#8d969e]">
          {copy.subheading}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-8 flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="auth-email"
            className="px-1 text-xs font-medium tracking-wide text-[#505a63] uppercase dark:text-[#8d969e]"
          >
            Email
          </label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
          />
          {fieldErrors.email ? (
            <p
              id="auth-email-error"
              className="px-1 text-xs text-[#e23b4a]"
            >
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="auth-password"
            className="px-1 text-xs font-medium tracking-wide text-[#505a63] uppercase dark:text-[#8d969e]"
          >
            Password
          </label>
          <Input
            id="auth-password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={
              fieldErrors.password ? "auth-password-error" : undefined
            }
          />
          {fieldErrors.password ? (
            <p
              id="auth-password-error"
              className="px-1 text-xs text-[#e23b4a]"
            >
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        {formError ? (
          <p
            role="alert"
            className="rounded-[14px] border border-[#e23b4a]/30 bg-[#e23b4a]/5 px-4 py-3 text-sm text-[#e23b4a]"
          >
            {formError}
          </p>
        ) : null}

        {infoMessage ? (
          <p
            role="status"
            className="rounded-[14px] border border-[rgba(25,28,31,0.1)] bg-[#f4f4f4] px-4 py-3 text-sm text-[#191c1f] dark:border-white/10 dark:bg-[#262a2e] dark:text-white"
          >
            {infoMessage}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? "Working…" : copy.submit}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[#505a63] dark:text-[#8d969e]">
        {copy.footer}{" "}
        <Link
          href={copy.footerHref}
          className="font-medium text-[#191c1f] underline-offset-4 hover:underline dark:text-white"
        >
          {copy.footerLinkLabel}
        </Link>
      </p>
    </main>
  );
}
