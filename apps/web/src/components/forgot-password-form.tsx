"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { cn } from "@/lib/utils";

import { AuthHeading, authStyles, FormError } from "./auth-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
      <AuthHeading
        title="Zapomenuté heslo"
        text="Napiš svůj e-mail. Pošlu ti odkaz, kde si nastavíš nové."
      />

      {state === "sent" ? (
        <p className={authStyles.notice}>
          Pokud u nás máš účet, do pár minut ti přijde e-mail s odkazem na nové heslo. Mrkni i do
          spamu.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <Label>
            E-mailová adresa
            <Input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="petr@dvorak-interiery.cz"
            />
          </Label>
          {error !== null && <FormError>{error}</FormError>}
          <Button type="submit" size="form" className="mt-3.5" disabled={state === "pending"}>
            Poslat odkaz
          </Button>
        </form>
      )}

      <p className={cn(authStyles.hint, "mt-5")}>
        <Link href="/prihlaseni" className={authStyles.link}>
          Zpět na přihlášení
        </Link>
      </p>
    </>
  );
}
