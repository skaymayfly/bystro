import { FileText, House, Mail, MessageSquare, Settings, TrendingUp } from "lucide-react";

import type { NavIcon as NavIconName } from "@/lib/navigation";

const ICONS = {
  home: House,
  assistant: MessageSquare,
  mail: Mail,
  cash: TrendingUp,
  invoices: FileText,
  settings: Settings,
} as const;

/** Line icon of a navigation item: thin stroke, 22 px in the tab bar, smaller in the sidebar. */
export function NavIcon({
  name,
  size = 22,
  className,
}: {
  name: NavIconName;
  size?: number;
  className?: string | undefined;
}) {
  const Icon = ICONS[name];
  return <Icon aria-hidden size={size} strokeWidth={1.7} className={className} />;
}
