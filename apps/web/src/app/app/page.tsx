import type { Metadata } from "next";

import { SignOutButton } from "@/components/sign-out-button";
import { requireRequestContext } from "@/server/context";

export const metadata: Metadata = { title: "Přehled – Bystro" };

/** Placeholder until the real layout (step 1.5) and onboarding (step 1.6) arrive. */
export default async function AppHomePage() {
  const { user, organization } = await requireRequestContext();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F3F2EF] p-6 text-[#161514]">
      <h1 className="text-3xl font-semibold">Ahoj, {user.name}</h1>
      <p className="text-[#55534E]">
        {organization === null
          ? "Jsi přihlášen(a). Firmu si založíš v dalším kroku, ten teprve stavíme."
          : organization.name}
      </p>
      <SignOutButton />
    </main>
  );
}
