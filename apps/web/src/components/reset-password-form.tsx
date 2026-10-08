"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { cn } from "@/lib/utils";

import { AuthHeading, authStyles, FormError } from "./auth-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
      <AuthHeading title="Nové heslo" text="Vyber si heslo, které má aspoň 8 znaků." />

      {token === null ? (
        <FormError>Odkaz už neplatí. Požádej o nový.</FormError>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <Label>
            Nové heslo
            <Input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Aspoň 8 znaků"
            />
          </Label>
          {error !== null && <FormError>{error}</FormError>}
          <Button type="submit" size="form" className="mt-3.5" disabled={pending}>
            Uložit heslo
          </Button>
        </form>
      )}

      <p className={cn(authStyles.hint, "mt-5")}>
        <Link href="/zapomenute-heslo" className={authStyles.link}>
          Poslat nový odkaz
        </Link>
      </p>
    </>
  );
}
