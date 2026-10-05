"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

import { authStyles } from "./auth-shell";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === null) {
      return;
    }
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");

    setError(null);
    setPending(true);
    const result = await authClient.resetPassword({ newPassword, token });
    if (result.error) {
      setError(authErrorMessage(result.error));
      setPending(false);
      return;
    }
    router.push("/prihlaseni?heslo=zmeneno");
  }

  return (
    <>
      <h1 className={authStyles.title}>Nové heslo</h1>

      {token === null ? (
        <p role="alert" className={authStyles.error}>
          Odkaz už neplatí. Požádej o nový.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <label className={authStyles.label}>
            Nové heslo
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Aspoň 8 znaků"
              className={authStyles.input}
            />
          </label>
          {error !== null && (
            <p role="alert" className={authStyles.error}>
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className={authStyles.primaryButton}>
            Uložit heslo
          </button>
        </form>
      )}

      <p className={`${authStyles.hint} text-center`}>
        <Link href="/zapomenute-heslo" className={authStyles.link}>
          Poslat nový odkaz
        </Link>
      </p>
    </>
  );
}
