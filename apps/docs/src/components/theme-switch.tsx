import { ThemeSwitch, type ThemeSwitchProps } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import type { FC } from "react";

// Replaces the default sidebar theme toggle so the social links sit inside the
// same bottom box as the light/dark switch. The sidebar passes the toggle a
// className carrying `ms-auto` (push right) plus merged borders; forwarding it
// to the real `ThemeSwitch` is what puts the links left and the switch right.
//
// The two glyphs and both URLs are the landing site's own (`apps/landing`'s
// footer), so a reader meets the same accounts in the same marks on either
// site.

const SOCIALS = [
  {
    href: "https://linkedin.com/company/mayarin",
    label: "Mayarin on LinkedIn",
    // Lockup traced from LinkedIn's brand mark, as the landing footer carries it.
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V8.997h3.414v1.561h.047c.475-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.371 4.267 5.456v6.288ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124ZM7.119 20.452H3.555V8.997h3.564v11.455Z",
  },
  {
    href: "https://x.com/mayarinxyz",
    label: "Mayarin on X",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.967 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z",
  },
] as const;

// The slot's own className is deliberately dropped. fumadocs sends
// `border-y-0 border-e-0 rounded-none` to flatten the toggle into the right
// edge of the box it draws around this footer; we want the toggle to keep its
// own rounded-full pill, and global.css strips that box to match.
export const ThemeSwitchWithSocial: FC<ThemeSwitchProps> = ({ className: _slot, ...props }) => (
  <>
    <div className="flex items-center gap-0.5">
      {SOCIALS.map((social) => (
        <a
          key={social.href}
          href={social.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex size-8 items-center justify-center rounded-full text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
            <path d={social.path} />
          </svg>
          {/* The mark alone is not a label a screen reader can read out. */}
          <span className="sr-only">{social.label}</span>
        </a>
      ))}
    </div>
    <ThemeSwitch className="ms-auto cursor-pointer" {...props} />
  </>
);
