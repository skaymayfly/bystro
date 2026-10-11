import Link from "next/link";

import { SoonBadge } from "@/components/bits";
import { Button, buttonVariants } from "@/components/ui/button";

const CONNECTIONS_PATH = "/app/nastaveni?karta=propojeni";

/**
 * "Připojit fakturaci": a link to Nastavení → Propojení where an invoicing system can be
 * connected, otherwise the disabled button with "Připravujeme".
 */
export function InvoicingCta({
  available,
  size = "default",
}: {
  available: boolean;
  size?: "default" | "sm";
}) {
  if (available) {
    return (
      <Link href={CONNECTIONS_PATH} className={buttonVariants({ size })}>
        Připojit fakturaci
      </Link>
    );
  }
  return (
    <>
      <Button size={size} disabled>
        Připojit fakturaci
      </Button>
      <SoonBadge />
    </>
  );
}
