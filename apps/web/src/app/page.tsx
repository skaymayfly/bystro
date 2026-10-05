import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/** Placeholder; the real landing page comes in step 9.3. */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">Bystro</h1>
      <p className="text-ink-2">Aplikaci teprve stavíme.</p>
      <div className="flex gap-2">
        <Link href="/prihlaseni" className={buttonVariants({ variant: "surface" })}>
          Přihlásit se
        </Link>
        <Link href="/registrace" className={buttonVariants()}>
          Vytvořit účet
        </Link>
      </div>
    </main>
  );
}
