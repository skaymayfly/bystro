import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn/ui button (base-nova) in the libraries.dev style: pills, the main action in blue,
// the secondary one a grey chip. A short press shrinks it a little (not with reduced motion).
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 border border-transparent whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-smooth outline-none select-none focus-visible:shadow-focus enabled:active:scale-[0.98] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-cta font-semibold text-cta-text hover:bg-cta-hover",
        secondary: "bg-chip font-medium text-ink hover:bg-fill active:bg-chip-pressed",
        outline: "border-line-strong bg-card font-medium text-ink hover:bg-chip",
        ghost: "font-medium text-ink-3 hover:text-ink",
      },
      size: {
        default: "h-[46px] rounded-full px-5 text-sm",
        sm: "h-8 rounded-full px-3.5 text-[13px] font-medium",
        form: "h-[52px] w-full rounded-pill px-5 text-base",
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
