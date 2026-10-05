import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn/ui button (base-nova) restyled to the Bystro prototype: pill shape, semibold labels.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:bg-ink",
        ink: "bg-ink text-white hover:bg-ink-2",
        secondary: "bg-secondary text-ink hover:bg-brand-soft",
        surface: "bg-card text-ink hover:bg-brand-soft",
        ghost: "text-ink-3 hover:text-ink",
        link: "text-ink underline underline-offset-2",
      },
      size: {
        sm: "px-4 py-[9px] text-[13px]",
        default: "px-5 py-3 text-sm",
        lg: "px-6 py-[15px] text-[15px]",
        xl: "p-[17px] text-[15px]",
        icon: "size-11 text-lg",
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
