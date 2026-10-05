import Link from "next/link";

/** Placeholder; the real landing page comes in step 9.3. */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F3F2EF] p-6 text-[#161514]">
      <h1 className="text-3xl font-semibold">Bystro</h1>
      <p className="text-[#55534E]">Aplikaci teprve stavíme.</p>
      <div className="flex gap-2">
        <Link
          href="/prihlaseni"
          className="rounded-full bg-white px-5 py-3 text-[14px] font-semibold"
        >
          Přihlásit se
        </Link>
        <Link
          href="/registrace"
          className="rounded-full bg-[#C94A2C] px-5 py-3 text-[14px] font-semibold text-white"
        >
          Vytvořit účet
        </Link>
      </div>
    </main>
  );
}
