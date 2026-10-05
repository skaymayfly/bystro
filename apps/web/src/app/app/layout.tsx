import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireRequestContext } from "@/server/context";

/** Everything under /app requires a validated session (the proxy only checks the cookie). */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { user, organization } = await requireRequestContext();

  return (
    <AppShell userName={user.name} organizationName={organization?.name ?? null}>
      {children}
    </AppShell>
  );
}
