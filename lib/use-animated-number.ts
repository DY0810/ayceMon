"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedNumberOptions {
  /** Tween duration in milliseconds. Default 350. */
  durationMs?: number;
}

/**
 * Tweens a number to its target value via requestAnimationFrame.
 * Respects prefers-reduced-motion (returns the target value immediately).
 *
 * Uses ease-out cubic so the change feels responsive on touch — fast at the
 * start, gentle landing. The previous frame is canceled on rapid changes,
 * so tapping +1 four times in a row produces one continuous tween, not four
 * stacked ones.
 */
export function useAnimatedNumber(
  value: number,
  options: AnimatedNumberOptions = {}
): number {
  const { durationMs = 350 } = options;
  const [displayed, setDisplayed] = useState(value);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef(value);

  useEffect(() => {
    // Honor reduced motion: skip the tween entirely.
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      fromRef.current = value;
      setDisplayed(value);
      return;
    }

    // Cancel any in-flight tween and start fresh from whatever's currently shown.
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }
    const from = displayed;
    fromRef.current = from;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(from + (to - from) * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // We intentionally only depend on `value` and `durationMs`. Including
    // `displayed` would cancel/restart the tween every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return displayed;
}
