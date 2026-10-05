"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/** Signs the user out and returns to the sign-in page. */
export function SignOutButton({
  label = "Odejít",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await authClient.signOut();
    router.push("/prihlaseni");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Odhlásit"
      className={cn("cursor-pointer p-1 text-xs text-ink-3 hover:text-ink", className)}
    >
      {label}
    </button>
  );
}
