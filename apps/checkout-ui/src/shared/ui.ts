/**
 * Class strings used by more than one buyer page. Plain Tailwind, named once so
 * a pay button on the link page cannot drift from the one on the invoice.
 */

/** The page's one action: a full-width pill, ink on the panel. */
export const primaryButton =
  "mt-6 flex min-h-11 w-full items-center justify-center rounded-full bg-ink px-5 text-sm font-medium text-panel transition-opacity enabled:hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40";

/** A second action beside or under the first. */
export const secondaryButton =
  "flex min-h-10 w-full items-center justify-center rounded-full border border-line bg-panel px-4 text-sm font-medium text-ink transition-colors enabled:hover:bg-field disabled:cursor-not-allowed disabled:opacity-40";

/** Above a field or a choice. */
export const fieldLabel = "mb-2 block text-sm text-ink";

/** The panel's heading. */
export const panelTitle = "m-0 text-xl font-medium text-ink";

/** The sentence under the panel's heading. */
export const panelIntro = "mt-1.5 mb-0 text-sm text-muted";

/** A refusal or a failure, under the control it belongs to. */
export const errorText = "mt-3 mb-0 text-sm text-danger";

/** Small print under the action. */
export const noteText = "mt-5 mb-0 text-xs leading-relaxed text-muted";

/** Quiet centred line: the reference, the "updates automatically". */
export const footnote = "mt-4 mb-0 text-center text-xs text-subtle";

/** A CSS chevron — the link page renders no SVG at all. */
export const chevron =
  "size-2 shrink-0 rotate-45 border-r border-b border-muted transition-transform duration-200";

/** Drawn over the left-hand ground or the panel. */
export const card = "rounded-2xl border border-line bg-field/50 p-4";

/** "Estimated total in USDC … 3.50": label left, figure right, between hairlines. */
export const estimateRow =
  "mt-6 flex items-baseline justify-between gap-4 border-y border-line py-4 [&>span]:text-sm [&>span]:text-muted [&>strong]:text-xl [&>strong]:font-medium [&>strong]:tabular-nums";

/** In place of the payment form, when there is nothing to pay with. */
export const unavailableBox =
  "mt-6 rounded-2xl border border-line p-5 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-medium [&>p]:mt-1.5 [&>p]:mb-0 [&>p]:text-muted";

/** Processing and the end states: a picture, a heading, a sentence. */
export const stateView = "flex flex-col items-center py-4 text-center";
export const stateTitle = "mt-6 mb-0 text-xl font-medium text-ink";
export const stateText = "mx-auto mt-2.5 mb-0 max-w-sm text-sm text-muted";
