import { Button } from "@/components/ui/button";

export type ConnectReturnTarget = "settings" | "onboarding";

/**
 * Starts connecting Fakturoid. A plain form post: the server answers with a redirect to
 * Fakturoid, where the user signs in and allows the access.
 */
export function ConnectForm({
  returnTo,
  label = "Propojit",
  size = "default",
  className,
}: {
  returnTo: ConnectReturnTarget;
  label?: string;
  size?: "default" | "sm" | "form";
  className?: string;
}) {
  return (
    <form method="post" action="/api/integrations/fakturoid/connect" className={className}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" size={size}>
        {label}
      </Button>
    </form>
  );
}
