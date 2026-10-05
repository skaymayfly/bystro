import type { ReactNode } from "react";

import { requireRequestContext } from "@/server/context";

/** Everything under /app requires a validated session (the proxy only checks the cookie). */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  await requireRequestContext();
  return children;
}
