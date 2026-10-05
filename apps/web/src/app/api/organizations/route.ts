import { organizationInputSchema } from "@bystro/core";
import { createFirstOrganization, OrganizationAlreadyExistsError } from "@bystro/db";

import { isSameOrigin, json, requireApiContext } from "@/server/api";
import { getDb } from "@/server/db";
import { readAuthEnv } from "@/server/env";

/**
 * POST /api/organizations — creates the signed-in user's first company (onboarding).
 * Body: { name, ico, dic?, street?, city?, postalCode?, vatPayer? }
 * 201 { id, name } · 400 { error: "invalid_input", fields } · 401 · 403 { error: "forbidden" }
 * 409 { error: "organization_exists" }
 */
export async function POST(request: Request) {
  const context = await requireApiContext();
  if (context instanceof Response) {
    return context;
  }
  if (!isSameOrigin(request, readAuthEnv().baseUrl)) {
    return json({ error: "forbidden" }, 403);
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = organizationInputSchema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")))];
    return json({ error: "invalid_input", fields }, 400);
  }

  try {
    const organization = await createFirstOrganization(getDb(), {
      organization: parsed.data,
      ownerUserId: context.user.id,
      source: "web",
    });
    return json({ id: organization.id, name: organization.name }, 201);
  } catch (error) {
    if (error instanceof OrganizationAlreadyExistsError) {
      return json({ error: "organization_exists" }, 409);
    }
    throw error;
  }
}
