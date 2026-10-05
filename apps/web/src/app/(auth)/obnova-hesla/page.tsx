import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata: Metadata = {
  title: "Nové heslo – Bystro",
  // The URL carries a one-time token: keep it out of Referer headers.
  referrer: "no-referrer",
};

export default async function ResetPasswordPage(props: PageProps<"/obnova-hesla">) {
  const params = await props.searchParams;
  // Better Auth redirects here with ?token=… or, for a bad or expired link, ?error=INVALID_TOKEN.
  const token = typeof params.token === "string" && params.token !== "" ? params.token : null;

  return (
    <AuthShell>
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
