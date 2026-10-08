import type * as React from "react";

import { cn } from "@/lib/utils";

// shadcn/ui label restyled to the Bystro prototype: the label wraps its field in a column.
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("flex flex-col gap-2 pl-0.5 text-[15px] text-ink-2", className)}
      {...props}
    />
  );
}

export { Label };
