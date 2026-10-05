import type * as React from "react";

import { cn } from "@/lib/utils";

// shadcn/ui label restyled to the Bystro prototype: the label wraps its field in a column.
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2", className)}
      {...props}
    />
  );
}

export { Label };
