import { ThemeSwitch, type ThemeSwitchProps } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import type { FC } from "react";

// Replaces the default sidebar theme toggle so the last commit hash sits
// inside the same bottom box as the light/dark switch. The sidebar passes the
// toggle a className with `ms-auto` (push right) + merged borders; we forward
// it to the real `ThemeSwitch` and render the hash link to its left.

export const ThemeSwitchWithHash: FC<ThemeSwitchProps & { readonly hash?: string }> = ({
  hash,
  className,
  ...props
}) => (
  <>
    {hash !== undefined && hash !== "unknown" && (
      <a
        href={`https://github.com/playriglabs/mayarin/commit/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="ms-1 inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[0.6875rem] text-fd-muted-foreground transition-colors hover:text-fd-foreground"
      >
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        {hash}
      </a>
    )}
    <ThemeSwitch
      className={className === undefined ? "cursor-pointer" : `${className} cursor-pointer`}
      {...props}
    />
  </>
);
