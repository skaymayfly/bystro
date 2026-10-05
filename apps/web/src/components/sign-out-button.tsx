"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
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
      className="cursor-pointer rounded-full bg-[#F3F2EF] px-5 py-3 text-[14px] font-semibold text-[#161514] disabled:opacity-60"
    >
      Odhlásit se
    </button>
  );
}
