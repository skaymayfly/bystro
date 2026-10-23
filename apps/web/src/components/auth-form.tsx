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

/** Google's multicolour "G", as its sign-in branding guidelines ask for on the button. */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-5">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

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
              <GoogleLogo />
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
