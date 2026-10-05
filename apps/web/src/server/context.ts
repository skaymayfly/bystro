import type { Role } from "@bystro/core";
import { listOrganizationsForUser, type Db, type Organization } from "@bystro/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SIGN_IN_PATH } from "./access";
import { getAuth } from "./auth";
import { getDb } from "./db";

export interface RequestUser {
  id: string;
  name: string;
  email: string;
}

export interface RequestContext {
  user: RequestUser;
  /** The organization the request acts on; `null` until the user creates one (onboarding). */
  organization: Organization | null;
  role: Role | null;
}

/**
 * Picks the active organization for a signed-in user: the first one they are a member of.
 * Only memberships are consulted, so a user can never end up in someone else's organization.
 */
export async function resolveRequestContext(db: Db, user: RequestUser): Promise<RequestContext> {
  const [first] = await listOrganizationsForUser(db, user.id);
  return {
    user,
    organization: first?.organization ?? null,
    role: first?.role ?? null,
  };
}

/** The validated session's context, or `null` when nobody is signed in. */
export async function getRequestContext(): Promise<RequestContext | null> {
  // Read the request first: during `next build` this is what marks the page as dynamic,
  // before anything needs the database or runtime secrets.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session === null) {
    return null;
  }
  const { id, name, email } = session.user;
  return resolveRequestContext(getDb(), { id, name, email });
}

/** For pages under /app: returns the context or redirects to sign-in. */
export async function requireRequestContext(): Promise<RequestContext> {
  const context = await getRequestContext();
  if (context === null) {
    redirect(SIGN_IN_PATH);
  }
  return context;
}
