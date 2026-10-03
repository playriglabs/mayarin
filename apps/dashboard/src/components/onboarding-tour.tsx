/**
 * The first-run tour: Driver.js highlighting the sidebar and header on the
 * overview, so a new merchant sees where things are before they go looking.
 *
 * Runs once per account per browser — the "done" flag is in `localStorage`,
 * keyed by user, and is set however the tour ends (finished, skipped, closed).
 * `/?tour=1` replays it; that is what "Take the tour" links to.
 *
 * Desktop only: on a phone the sidebar it points at is hidden behind the
 * menu, so the tour does not run there and is not marked done — the merchant
 * still gets it the first time they open the dashboard on a wider screen. A
 * step whose target is missing anyway is shown as a centred popover; a step
 * for a page the account cannot open is dropped.
 */

import { type DriveStep, driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useEffect } from "react";
import type { Permission } from "@/types/user";

interface TourStep {
  /** A `data-tour` value; absent for a centred popover. */
  readonly target?: string;
  readonly permission?: Permission;
  /** Where the popover sits: right of a sidebar item, below a header control. */
  readonly side?: "right" | "bottom";
  readonly title: string;
  readonly description: string;
}

const STEPS: readonly TourStep[] = [
  {
    title: "Welcome to Mayarin",
    description:
      "You price in your currency and get paid in a stablecoin. Payers bring any supported asset. Take a minute to see where everything is.",
  },
  {
    target: "nav-/settings",
    permission: "settings:manage",
    title: "Start here: get paid",
    description:
      "Choose your settlement asset and payout address. Turn on buyer protection if you sell goods that ship.",
  },
  {
    target: "nav-/wallets",
    permission: "settings:manage",
    title: "Your wallet",
    description:
      "Payments settle here. Verify your own address or use the managed wallet, and withdraw anytime.",
  },
  {
    target: "nav-/links",
    permission: "catalog:manage",
    title: "Your first payment, no code",
    description: "Create a link, share it, and the buyer pays with any supported asset.",
  },
  {
    target: "nav-/invoices",
    permission: "catalog:manage",
    title: "Bill a customer",
    description: "Send a numbered invoice by email. They pay from the link inside it.",
  },
  {
    target: "nav-/payments",
    title: "Every payment, live",
    description: "Track each payment from received to settled.",
  },
  {
    target: "nav-/disputes",
    permission: "payments:read",
    title: "Answer disputes",
    description:
      "When a buyer disputes an escrowed payment, answer here before the deadline, or they are refunded.",
  },
  {
    target: "nav-/settlement",
    title: "What you actually received",
    description: "Net amounts after fees, matched against the chain.",
  },
  {
    target: "nav-group-developers",
    title: "Build with Mayarin",
    description: "API keys, webhooks and agent endpoints for integrating your own store or app.",
  },
  {
    target: "notifications",
    permission: "payments:read",
    side: "bottom",
    title: "Stay in the loop",
    description:
      "Payments, disputes, refunds and account changes show up here. You also get an email when you get paid.",
  },
  {
    target: "search",
    side: "bottom",
    title: "Find anything",
    description: "Jump to any page or payment from here.",
  },
  {
    title: "You're set",
    description:
      "Start with Settings, then create your first payment link. Replay this tour anytime from the signpost button in the header.",
  },
];

const REPLAY_PARAM = "tour";

function doneKey(userId: string): string {
  return `mayarin:tour-done:${userId}`;
}

function isDone(userId: string): boolean {
  try {
    return window.localStorage.getItem(doneKey(userId)) !== null;
  } catch {
    // Storage blocked: showing the tour every visit would be worse than never.
    return true;
  }
}

function markDone(userId: string): void {
  try {
    window.localStorage.setItem(doneKey(userId), new Date().toISOString());
  } catch {
    // Nothing to keep it in; the tour simply shows again next time.
  }
}

/** The element for a `data-tour` value, when it is on screen. */
function visible(target: string): Element | undefined {
  const element = document.querySelector(`[data-tour="${target}"]`);
  return element !== null && element.getClientRects().length > 0 ? element : undefined;
}

function toDriveStep(step: TourStep): DriveStep {
  const element = step.target === undefined ? undefined : visible(step.target);
  return {
    ...(element === undefined ? {} : { element }),
    popover: {
      title: step.title,
      description: step.description,
      ...(element === undefined
        ? {}
        : step.side === "bottom"
          ? { side: "bottom", align: "end" }
          : { side: "right", align: "start" }),
    },
  };
}

/**
 * Blurs the page behind the tour, but not the highlighted element.
 *
 * Driver.js dims with one full-screen SVG whose path has a hole cut where the
 * element is. A `backdrop-filter` on that SVG would blur the hole too — the
 * filter covers the element's box, not its painted shape — so the SVG is
 * clipped to its own path. The path moves every frame while the highlight
 * travels, hence an observer rather than a hook.
 */
function blurOverlay(): () => void {
  const sync = () => {
    const svg = document.querySelector<SVGSVGElement>("svg.driver-overlay");
    const d = svg?.querySelector("path")?.getAttribute("d");
    if (svg === null || svg === undefined || d === null || d === undefined) return;
    svg.style.clipPath = `path(evenodd, "${d.replace(/\s+/g, " ").trim()}")`;
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["d"],
  });
  return () => observer.disconnect();
}

export default function OnboardingTour({
  userId,
  permissions,
}: {
  readonly userId: string;
  readonly permissions: readonly Permission[];
}) {
  useEffect(() => {
    if (window.location.pathname !== "/") return;
    // `md`, where the sidebar is shown (dashboard.astro).
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    const url = new URL(window.location.href);
    const replay = url.searchParams.has(REPLAY_PARAM);
    if (!replay && isDone(userId)) return;
    if (replay) {
      url.searchParams.delete(REPLAY_PARAM);
      window.history.replaceState(null, "", url);
    }

    // After the other islands hydrate, so the bell and search are there to point at.
    let unblur: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      unblur = blurOverlay();
      const tour = driver({
        showProgress: true,
        progressText: "{{current}} of {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        popoverClass: "mayarin-tour",
        stagePadding: 4,
        stageRadius: 8,
        // The same scrim as every dialog (`--scrim-color` in global.css).
        overlayColor: "#000",
        overlayOpacity: 0.35,
        steps: STEPS.filter(
          (step) => step.permission === undefined || permissions.includes(step.permission),
        ).map(toDriveStep),
        // Driver.js only scrolls the window. A sidebar item below the fold sits
        // inside the nav's own scroll box, where it is "on screen" but hidden,
        // so it is brought into view before the highlight measures it.
        onHighlightStarted: (element) => {
          element?.scrollIntoView({ block: "center", inline: "nearest" });
        },
        onDestroyed: () => {
          unblur?.();
          markDone(userId);
        },
      });
      tour.drive();
    }, 600);
    return () => {
      window.clearTimeout(timer);
      unblur?.();
    };
  }, [userId, permissions]);

  return null;
}
