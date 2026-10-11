import { Button } from "@/components/ui/button";
import type { InvoicingProviderId } from "@/lib/invoicing-providers";

export type ConnectReturnTarget = "settings" | "onboarding";

/**
 * Starts connecting an invoicing system. A plain form post: the server answers with a
 * redirect to the provider, where the user signs in and allows the access.
 */
export function ConnectForm({
  provider,
  returnTo,
  label = "Propojit",
  size = "default",
  className,
}: {
  provider: InvoicingProviderId;
  returnTo: ConnectReturnTarget;
  label?: string;
  size?: "default" | "sm" | "form";
  className?: string;
}) {
  return (
    <form method="post" action={`/api/integrations/${provider}/connect`} className={className}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" size={size}>
        {label}
      </Button>
    </form>
  );
}
