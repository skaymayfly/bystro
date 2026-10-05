import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

// shadcn/ui input (base-nova) restyled to the Bystro prototype.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 rounded-field border border-line bg-field px-4 py-[15px] text-[15px] font-normal text-ink transition-colors outline-none placeholder:text-ink-4 focus-visible:border-ink disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
