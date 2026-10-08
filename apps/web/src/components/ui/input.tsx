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
        "h-[52px] w-full min-w-0 rounded-control border border-line-strong bg-card px-4 text-base font-normal text-ink transition-[border-color,box-shadow] outline-none placeholder:text-ink-4 focus-visible:border-ink-2 focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-3 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
