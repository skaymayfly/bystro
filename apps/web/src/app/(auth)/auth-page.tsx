import { redirect } from "next/navigation";

import { AuthForm, type AuthMode } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { safeNextPath } from "@/server/access";
import { isGoogleSignInEnabled } from "@/server/auth";
import { getRequestContext } from "@/server/context";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Shared body of /registrace and /prihlaseni. */
export async function AuthPage({
  mode,
  searchParams,
}: {
  mode: AuthMode;
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(first(params.next));

  if ((await getRequestContext()) !== null) {
    redirect(nextPath);
  }

  const notice =
    mode === "login" && first(params.heslo) === "zmeneno"
      ? "Heslo je změněné. Teď se s ním přihlas."
      : undefined;

  return (
    <AuthShell>
      <AuthForm
        mode={mode}
        nextPath={nextPath}
        googleEnabled={isGoogleSignInEnabled()}
        notice={notice}
      />
    </AuthShell>
  );
}
