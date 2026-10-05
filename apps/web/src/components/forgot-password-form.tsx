"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

import { authStyles } from "./auth-shell";

export function ForgotPasswordForm() {
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();

    setError(null);
    setState("pending");
    const result = await authClient.requestPasswordReset({ email, redirectTo: "/obnova-hesla" });
    // Rate limiting and malformed input are the only errors shown; whether the address
    // has an account is never revealed.
    if (result.error && (result.error.status === 429 || result.error.code === "INVALID_EMAIL")) {
      setError(authErrorMessage(result.error));
      setState("idle");
      return;
    }
    setState("sent");
  }

  return (
    <>
      <h1 className={authStyles.title}>Zapomenuté heslo</h1>

      {state === "sent" ? (
        <p className={authStyles.notice}>
          Pokud u nás máš účet, do pár minut ti přijde e-mail s odkazem na nové heslo. Mrkni i do
          spamu.
        </p>
      ) : (
        <>
          <p className={authStyles.hint}>
            Napiš svůj e-mail. Pošlu ti odkaz, kde si nastavíš nové.
          </p>
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <label className={authStyles.label}>
              E-mail
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="petr@dvorak-interiery.cz"
                className={authStyles.input}
              />
            </label>
            {error !== null && (
              <p role="alert" className={authStyles.error}>
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={state === "pending"}
              className={authStyles.primaryButton}
            >
              Poslat odkaz
            </button>
          </form>
        </>
      )}

      <p className={`${authStyles.hint} text-center`}>
        <Link href="/prihlaseni" className={authStyles.link}>
          Zpět na přihlášení
        </Link>
      </p>
    </>
  );
}
