/**
 * The two surfaces every auth page sits on.
 *
 * `AuthCard` is the narrow centred card — sign in, the first register step,
 * the code step. `AuthSetup` is the wide frame for the register step that
 * asks about the business: a brand column on the left, the form on the right
 * and its action pinned to a footer bar. React rather than the Astro layout,
 * because register moves between the two without a page load.
 *
 * The toaster mounts in `AuthCard`, in the same React tree as the form, rather than as
 * its own island: sonner does not replay a toast fired before its `Toaster`
 * subscribes, and two islands hydrate in no promised order. A child's effect
 * runs before its parent's, so this one is listening by the time the form's
 * mount effect fires.
 */

import type { ReactNode } from "react";
import ThemeToggle from "@/components/theme-toggle";
import Toaster from "@/components/ui/toaster";

function AuthLogo() {
  return (
    <>
      <img
        src="https://mayarin.xyz/brand-kit/mayarin-logo-black.svg"
        alt=""
        aria-hidden="true"
        width="40"
        height="40"
        className="auth-logo auth-logo-light size-10"
      />
      <img
        src="https://mayarin.xyz/brand-kit/mayarin-logo-white.svg"
        alt=""
        aria-hidden="true"
        width="40"
        height="40"
        className="auth-logo auth-logo-dark size-10"
      />
    </>
  );
}

export function AuthCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-6 px-6 pt-20 pb-10 sm:my-12 sm:max-w-[27rem] sm:rounded-3xl sm:border sm:border-border sm:bg-card sm:p-8 dark:sm:border-transparent dark:sm:bg-muted">
      <a href="https://mayarin.xyz" aria-label="Mayarin home" className="inline-flex w-fit">
        <AuthLogo />
      </a>
      {children}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>
      <Toaster />
    </div>
  );
}

export function AuthSetup({
  children,
  aside,
  footer,
}: {
  readonly children: ReactNode;
  /** Bottom of the brand column. */
  readonly aside?: ReactNode;
  readonly footer: ReactNode;
}) {
  return (
    <div className="flex min-h-svh w-full lg:items-center lg:justify-center lg:p-6">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 flex-col lg:h-[min(48rem,calc(100svh-3rem))] lg:max-w-5xl lg:flex-row lg:gap-3 lg:rounded-3xl lg:border lg:border-border lg:bg-card lg:p-3 dark:lg:border-transparent dark:lg:bg-muted">
        <div className="flex items-center justify-between px-6 pt-20 pb-6 lg:w-80 lg:shrink-0 lg:flex-col lg:items-start lg:p-10">
          <a
            href="https://mayarin.xyz"
            aria-label="Mayarin home"
            className="inline-flex items-center"
          >
            <AuthLogo />
            <span className="-ml-0.5 font-sans text-[1.75rem] font-medium leading-none tracking-[-0.06em]">
              mayarin
            </span>
          </a>
          {aside !== undefined && (
            <div className="hidden text-sm text-muted-foreground lg:block">{aside}</div>
          )}
        </div>

        <div className="flex flex-1 flex-col bg-background lg:rounded-2xl lg:border lg:border-border">
          <div className="flex flex-1 justify-center px-6 py-6 lg:py-16">
            <div className="w-full max-w-lg">{children}</div>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}
