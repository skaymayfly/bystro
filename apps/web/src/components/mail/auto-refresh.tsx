"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Reloads the screen's data every few seconds while something is loading in the
 * background (the mailbox's first load), so that new mail appears without a manual reload.
 */
export function AutoRefresh({ intervalMs = 8_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
