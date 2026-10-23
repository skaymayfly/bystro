"use client";

import { Archive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

const MESSAGES: Record<string, string> = {
  reauth_required: "Gmail je potřeba znovu připojit. Pak to zkus znovu.",
  not_found: "Tohle vlákno už ve schránce není.",
};
const FALLBACK = "Archivovat se teď nepovedlo. Zkus to prosím za chvíli.";

/** Archives the thread in Gmail and Bystro, then goes back to the folder. */
export function ArchiveButton({ threadId, backHref }: { threadId: string; backHref: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/mail/threads/${encodeURIComponent(threadId)}/archive`, {
        method: "POST",
      });
      if (response.status === 204) {
        router.push(backHref);
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(MESSAGES[body?.error ?? ""] ?? FALLBACK);
    } catch {
      setError(FALLBACK);
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="secondary" size="sm" onClick={archive} disabled={pending}>
        <Archive aria-hidden />
        {pending ? "Archivuji…" : "Archivovat"}
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-danger-strong">
          {error}
        </p>
      )}
    </div>
  );
}
