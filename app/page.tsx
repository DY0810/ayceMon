"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAyceStore } from "@/lib/store";

interface Step {
  readonly number: string;
  readonly title: string;
  readonly description: string;
}

const STEPS: readonly Step[] = [
  {
    number: "1",
    title: "Set the buffet price",
    description: "Start a session with what you paid to walk in.",
  },
  {
    number: "2",
    title: "Build your item library",
    description: "Add the dishes on offer with rough value and fill.",
  },
  {
    number: "3",
    title: "Get top combos",
    description: "See the highest-value combinations you could eat.",
  },
  {
    number: "4",
    title: "Track & verify",
    description: "Log what you actually ate and see if you beat the bill.",
  },
] as const;

export default function Home() {
  const session = useAyceStore((state) => state.session);
  const hasHydrated = useAyceStore((state) => state._hasHydrated);

  if (!hasHydrated) {
    return null;
  }

  const sessionActive = session !== null;
  const ctaHref = sessionActive ? "/library" : "/setup";
  const ctaLabel = sessionActive
    ? `Resume at ${session.restaurantName ?? "your session"}`
    : "Start a session";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 lg:px-8 lg:py-20">
      <section className="flex flex-col gap-6">
        <h1
          className="ayce-fade-up font-heading text-4xl font-semibold tracking-tight lg:text-6xl"
          style={{ animationDelay: "0ms" }}
        >
          Make your money worth at AYCE.
        </h1>
        <p
          className="ayce-fade-up max-w-2xl text-base text-muted-foreground lg:text-lg"
          style={{ animationDelay: "80ms" }}
        >
          Enter the buffet price, build a menu of what&apos;s available, and
          we&apos;ll find the highest-value combos to eat. Track what you
          actually ate and find out if you beat the bill.
        </p>
        <div
          className="ayce-fade-up flex flex-col gap-3 sm:flex-row sm:items-center"
          style={{ animationDelay: "160ms" }}
        >
          <Link
            href={ctaHref}
            className={cn(buttonVariants({ variant: "default" }), "h-11 px-6 text-base")}
          >
            {ctaLabel}
            <ArrowRight className="ml-1 size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="mt-14 lg:mt-20">
        <h2
          className="ayce-fade-up font-heading text-2xl font-semibold tracking-tight lg:text-3xl"
          style={{ animationDelay: "240ms" }}
        >
          How it works
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Card
              key={step.number}
              className="ayce-fade-up"
              style={{ animationDelay: `${320 + index * 60}ms` }}
            >
              <CardHeader>
                <div
                  className="font-heading text-3xl font-semibold text-foreground"
                  aria-hidden="true"
                >
                  {step.number}
                </div>
                <CardTitle className="text-base">{step.title}</CardTitle>
                <CardDescription>{step.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
