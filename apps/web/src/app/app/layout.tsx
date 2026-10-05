import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { ONBOARDING_PATH } from "@/server/access";
import { requireRequestContext } from "@/server/context";

/**
 * Everything under /app requires a validated session (the proxy only checks the cookie)
 * and a company; users without one finish onboarding first.
 */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { user, organization } = await requireRequestContext();
  if (organization === null) {
    redirect(ONBOARDING_PATH);
  }

  return (
    <AppShell userName={user.name} organizationName={organization.name}>
      {children}
    </AppShell>
  );
}
