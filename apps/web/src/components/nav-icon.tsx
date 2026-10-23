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

/** Line icon of a navigation item, drawn like the prototype's (thin stroke, 22 px). */
export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden size={22} strokeWidth={1.6} className={className} />;
}
