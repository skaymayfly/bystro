"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { cn } from "@/lib/utils";

import { authStyles } from "./auth-shell";
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

const tabClass = (active: boolean) =>
  cn(
    "flex-1 rounded-full p-[11px] text-center text-sm font-semibold text-ink",
    active ? "bg-card" : "bg-transparent",
  );

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
    const name = String(form.get("name") ?? "").trim();

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
      <nav className="flex rounded-full bg-secondary p-1" aria-label="Registrace nebo přihlášení">
        <Link
          href={`/registrace${nextQuery}`}
          className={tabClass(isSignup)}
          aria-current={isSignup ? "page" : undefined}
        >
          Registrace
        </Link>
        <Link
          href={`/prihlaseni${nextQuery}`}
          className={tabClass(!isSignup)}
          aria-current={isSignup ? undefined : "page"}
        >
          Přihlášení
        </Link>
      </nav>

      <h1 className={authStyles.title}>{isSignup ? "Začni zdarma na 30 dní" : "Vítej zpátky"}</h1>

      {notice !== undefined && <p className={authStyles.notice}>{notice}</p>}

      {googleEnabled && (
        <>
          <Button type="button" variant="secondary" size="lg" onClick={onGoogle} disabled={pending}>
            Pokračovat přes Google
          </Button>
          <div className="flex items-center gap-3 text-[13px] text-ink-4">
            <div className="h-px flex-1 bg-line" />
            nebo e-mailem
            <div className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {isSignup && (
          <Label>
            Jméno a příjmení
            <Input name="name" required autoComplete="name" placeholder="Petr Dvořák" />
          </Label>
        )}
        <Label>
          E-mail
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

        {error !== null && (
          <p role="alert" className={authStyles.error}>
            {error}
          </p>
        )}

        <Button type="submit" size="xl" disabled={pending}>
          {isSignup ? "Vytvořit účet" : "Přihlásit se"}
        </Button>
      </form>

      {!isSignup && (
        <p className={cn(authStyles.hint, "text-center")}>
          <Link href="/zapomenute-heslo" className={authStyles.link}>
            Nepamatuju si heslo
          </Link>
        </p>
      )}
    </>
  );
}
