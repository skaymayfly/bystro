import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn/ui button (base-nova) restyled to the Bystro prototype. The size decides the shape:
// pills inside the app, squarer controls in forms and in the compact Přehled.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 border border-transparent whitespace-nowrap transition-colors outline-none select-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-ink font-semibold text-white hover:bg-ink-hover",
        secondary: "border-line-strong bg-muted font-medium text-ink hover:bg-fill",
        outline: "border-line-strong bg-card font-medium text-ink hover:bg-subtle",
        ghost: "font-medium text-ink-3 hover:text-ink",
      },
      size: {
        default: "h-[46px] rounded-full px-5 text-sm",
        sm: "h-8 rounded-lg px-3 text-[13px] font-medium",
        form: "h-[52px] w-full rounded-control px-5 text-base",
        icon: "size-11 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
