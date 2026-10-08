"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

import { AuthHeading, authStyles, FormError } from "./auth-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export type AuthMode = "signup" | "login";

interface AuthFormProps {
  mode: AuthMode;
  /** Safe in-app path to open after signing in. */
  nextPath: string;
  googleEnabled: boolean;
  /** One-off message shown above the form (e.g. after a password reset). */
  notice?: string | undefined;
}

export function AuthForm({ mode, nextPath, googleEnabled, notice }: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isSignup = mode === "signup";
  const nextQuery = nextPath === "/app" ? "" : `?next=${encodeURIComponent(nextPath)}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = [form.get("firstName"), form.get("lastName")]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" ");

    setError(null);
    setPending(true);
    const result = isSignup
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(authErrorMessage(result.error));
      setPending(false);
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  async function onGoogle() {
    setError(null);
    setPending(true);
    const result = await authClient.signIn.social({ provider: "google", callbackURL: nextPath });
    if (result.error) {
      setError(authErrorMessage(result.error));
      setPending(false);
    }
  }

  return (
    <>
      <AuthHeading
        title={isSignup ? "Začni s Bystro" : "Vítej zpátky v Bystro"}
        text={
          isSignup
            ? "Nastavení Bystro zabere méně než 3 minuty"
            : "Přihlas se a uvidíš, co je dnes důležité."
        }
      />

      <div className="flex flex-col gap-5">
        {notice !== undefined && <p className={authStyles.notice}>{notice}</p>}

        {googleEnabled && (
          <>
            <Button
              type="button"
              variant="outline"
              size="form"
              onClick={onGoogle}
              disabled={pending}
            >
              Pokračovat přes Google
            </Button>
            <div className="flex items-center gap-3 text-sm text-ink-4">
              <div className="h-px flex-1 bg-line-strong" />
              nebo e-mailem
              <div className="h-px flex-1 bg-line-strong" />
            </div>
          </>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          {isSignup && (
            <div className="grid grid-cols-2 gap-3">
              <Label>
                Jméno
                <Input name="firstName" required autoComplete="given-name" placeholder="Petr" />
              </Label>
              <Label>
                Příjmení
                <Input name="lastName" required autoComplete="family-name" placeholder="Dvořák" />
              </Label>
            </div>
          )}
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
          <Label>
            Heslo
            <Input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? "Aspoň 8 znaků" : "Tvoje heslo"}
            />
          </Label>

          {error !== null && <FormError>{error}</FormError>}

          <Button type="submit" size="form" className="mt-3.5" disabled={pending}>
            {isSignup ? "Vytvořit účet" : "Přihlásit se"}
          </Button>
        </form>

        <p className={authStyles.hint}>
          {isSignup ? "Už máš účet?" : "Ještě nemáš účet?"}{" "}
          <Link
            href={isSignup ? `/prihlaseni${nextQuery}` : `/registrace${nextQuery}`}
            className={authStyles.link}
          >
            {isSignup ? "Přihlásit se" : "Zaregistrovat se"}
          </Link>
        </p>

        {!isSignup && (
          <p className={authStyles.hint}>
            <Link href="/zapomenute-heslo" className={authStyles.link}>
              Nepamatuju si heslo
            </Link>
          </p>
        )}
      </div>
    </>
  );
}
