import type { ReactNode } from "react";

import { NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { Logo, LogoMark } from "./bits";
import { NavIcon } from "./nav-icon";

/** Decorative sketch of the app next to the form, as in the prototype. */
function AppPreview({ title, subtitle }: { title: string; subtitle: string }) {
  const bar = "h-3 rounded-full bg-line-soft";
  return (
    <div aria-hidden className="relative hidden min-h-[640px] overflow-hidden bg-card lg:block">
      <div className="absolute top-[15%] -right-0.5 -bottom-0.5 left-[16%] flex rounded-tl-[32px] border border-r-0 border-b-0 border-line bg-chrome">
        <div className="flex w-[min(430px,45vw)] flex-none flex-col px-[38px] py-[42px]">
          <div className="flex items-center gap-3.5">
            <LogoMark className="size-[46px]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-2xl font-semibold tracking-[-0.02em]">{title}</div>
              <div className="truncate text-[15px] text-ink-3">{subtitle}</div>
            </div>
          </div>
          {[1, 2].map((group) => (
            <div
              key={group}
              className={
                group === 1
                  ? "mt-10 flex flex-col border-y border-line-soft py-[22px]"
                  : "flex flex-col py-[22px]"
              }
            >
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                <div key={item.href} className="flex items-center gap-4 py-3.5 text-xl text-ink-2">
                  <NavIcon name={item.icon} className="text-ink-3" />
                  {item.label}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-3 flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-panel border border-r-0 border-b-0 border-line bg-card pt-24 pl-[88px]">
          <div className="h-5 w-[230px] rounded-full bg-line-soft" />
          <div className={`${bar} mt-[26px] w-full`} />
          <div className={`${bar} mt-3 w-[255px]`} />
          <div className="mt-12 h-[260px] rounded-l-3xl bg-chrome" />
          <div className={`${bar} mt-[68px] w-full`} />
          <div className={`${bar} mt-3 w-[255px]`} />
        </div>
      </div>
    </div>
  );
}

/**
 * Two-panel layout of the sign-in and onboarding screens from the prototype: the form on a
 * light panel, a sketch of the app beside it on wide screens.
 */
export function AuthShell({
  children,
  logoHref = "/",
  aside,
  previewTitle = "Tvoje firma",
  previewSubtitle = "Faktury, banka a ranní přehled",
}: {
  children: ReactNode;
  logoHref?: string;
  /** Shown opposite the logo, e.g. the onboarding step counter. */
  aside?: ReactNode;
  previewTitle?: string;
  previewSubtitle?: string;
}) {
  return (
    <div className="grid min-h-screen bg-card lg:grid-cols-2">
      <div className="flex min-h-screen flex-col bg-subtle px-5 pt-7 pb-10 sm:px-10">
        <div className="flex items-center justify-between gap-4">
          <Logo href={logoHref} />
          {aside}
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-[500px] flex-col">{children}</div>
        </div>
      </div>
      <AppPreview title={previewTitle} subtitle={previewSubtitle} />
    </div>
  );
}

/** Heading block shared by the sign-in and onboarding forms. */
export function AuthHeading({
  title,
  text,
  className,
}: {
  title: string;
  text?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-7 flex flex-col gap-2.5", className)}>
      <h1 className="text-[clamp(32px,3vw,40px)] leading-[1.1] font-semibold tracking-[-0.035em]">
        {title}
      </h1>
      {text !== undefined && <p className="text-[17px] leading-[1.45] text-ink-3">{text}</p>}
    </div>
  );
}

/** Inline error line of the prototype: red text with a dot. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-center gap-2 text-sm text-danger-strong">
      <span aria-hidden className="size-1.5 flex-none rounded-full bg-danger" />
      {children}
    </p>
  );
}

export const authStyles = {
  hint: "text-center text-base text-ink-3",
  link: "text-ink-2 underline decoration-dotted underline-offset-4 hover:text-ink",
  notice:
    "rounded-control border border-line-strong bg-card px-4 py-3.5 text-sm leading-normal text-ink-2",
} as const;
