import Link from "next/link";

import { LogoMark, Wordmark } from "@/components/bits";
import { buttonVariants } from "@/components/ui/button";

/** Placeholder; the real landing page comes in step 9.3. */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-subtle p-6 text-center">
      <div className="flex items-center gap-3">
        <LogoMark className="size-11" />
        <h1>
          <Wordmark className="text-[34px]" />
        </h1>
      </div>
      <p className="text-[17px] text-ink-3">Aplikaci teprve stavíme.</p>
      <div className="flex gap-2">
        <Link href="/prihlaseni" className={buttonVariants({ variant: "secondary" })}>
          Přihlásit se
        </Link>
        <Link href="/registrace" className={buttonVariants()}>
          Vytvořit účet
        </Link>
      </div>
    </main>
  );
}
