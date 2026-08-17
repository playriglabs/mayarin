/**
 * Auto-generated Open Graph images for payment links and invoices (#165).
 *
 * Sharing a buyer URL in WhatsApp / Telegram / X renders a preview card. With
 * only the static `mayarin.xyz/og-image.png` in the shell, every link shares the
 * same generic card. This renders a per-document PNG — merchant name plus the
 * human-form amount and asset — so a payer recognizes the charge before they
 * tap.
 *
 * `satori` turns a tiny element tree into SVG; `@resvg/resvg-js` rasterizes it
 * to PNG. Twitter/X reject SVG OG images, so PNG is the wire format. Money is
 * rendered with `formatMoneyLocale` (the human form, `id-ID`) — never
 * `toDecimalString` and never a `number`.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InvoiceStatus } from "@mayarin/invoicing";
import { formatMoneyLocale, type Money } from "@mayarin/shared";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

/** OG image dimensions, the de-facto 1200×630 every crawler expects. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");
const FONT_NAME = "Geist";

interface FontFile {
  readonly weight: 400 | 600 | 700;
  readonly file: string;
}

// Static instances rather than the variable TTF: satori's bundled opentype parser
// chokes on the variable `fvar` axes, so the variable font renders nothing.
const FONT_FILES: readonly FontFile[] = [
  { weight: 400, file: "geist-regular.ttf" },
  { weight: 600, file: "geist-semibold.ttf" },
  { weight: 700, file: "geist-bold.ttf" },
];

let fontsPromise:
  | Promise<{ name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" }[]>
  | undefined;

/** Loads the bundled Geist static fonts once. Satori needs a font buffer per weight. */
function fonts() {
  if (fontsPromise === undefined) {
    fontsPromise = Promise.all(
      FONT_FILES.map(async (f) => ({
        name: FONT_NAME,
        data: await Bun.file(join(ASSETS_DIR, f.file)).arrayBuffer(),
        weight: f.weight,
        style: "normal" as const,
      })),
    );
  }
  return fontsPromise;
}

// Brand palette, lifted from `apps/checkout-ui/src/styles.css` so the card reads
// as the same product: paper #ffffff, ink #111111, brand green #1f6f54.
const PAPER = "#ffffff";
const INK = "#111111";
const BRAND = "#1f6f54";
const MUTED = "#6b7280";

/** A minimal React-element shape, so satori runs without a JSX tsconfig. */
interface Element {
  readonly type: string;
  readonly props: {
    readonly style?: object;
    readonly children?: Element | string | readonly (Element | string)[];
  };
}

function el(
  type: string,
  style: object,
  children: Element | string | readonly (Element | string)[],
): Element {
  return { type, props: { style, children } };
}

/** What a card renders: a headline, a secondary line, and an optional state tag. */
export interface OgCard {
  readonly merchantName: string;
  readonly headline: string;
  readonly subline: string;
  readonly stateLabel?: string;
}

/** The text a crawler puts under the title — the subline, kept short. */
export function ogDescription(card: OgCard): string {
  return card.stateLabel === undefined ? card.subline : `${card.stateLabel} · ${card.subline}`;
}

/** Builds the `<meta>` tags a shell injects, for one document. */
export function ogMetaTags(tags: {
  readonly title: string;
  readonly description: string;
  readonly imageUrl: string;
  readonly imageAlt: string;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const d = tags.description;
  const img = tags.imageUrl;
  const alt = tags.imageAlt;
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Mayarin Pay" />`,
    `<meta property="og:title" content="${esc(tags.title)}" />`,
    `<meta property="og:description" content="${esc(d)}" />`,
    `<meta property="og:image" content="${esc(img)}" />`,
    `<meta property="og:image:width" content="${OG_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(tags.title)}" />`,
    `<meta name="twitter:description" content="${esc(d)}" />`,
    `<meta name="twitter:image" content="${esc(img)}" />`,
    `<meta name="twitter:image:alt" content="${esc(alt)}" />`,
  ].join("\n    ");
}

/**
 * The static default card meta, for pages that do not carry document data (the
 * pay page). Reuses the generic landing-hosted image, so no new static asset is
 * needed for the one page that has nothing document-specific to show.
 */
export function defaultOgMeta(): string {
  return ogMetaTags({
    title: "Mayarin Pay",
    description: "Secure stablecoin checkout powered by Mayarin Pay.",
    imageUrl: "https://mayarin.xyz/og-image.png",
    imageAlt: "Mayarin Pay secure stablecoin checkout",
  });
}

function cardElement(card: OgCard): Element {
  // A left-aligned column on the brand paper, brand accent rule on the left,
  // merchant name + headline + subline, and a Mayarin Pay wordmark footer.
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: PAPER,
      padding: "80px",
      justifyContent: "space-between",
    },
    [
      el("div", { display: "flex", flexDirection: "column", gap: "24px" }, [
        el("div", { display: "flex", alignItems: "center", gap: "16px" }, [
          el(
            "div",
            { width: "10px", height: "56px", backgroundColor: BRAND, borderRadius: "6px" },
            "",
          ),
          el(
            "div",
            { fontSize: "30px", fontWeight: 600, color: INK, letterSpacing: "-0.5px" },
            card.merchantName,
          ),
        ]),
        el(
          "div",
          {
            fontSize: "76px",
            fontWeight: 700,
            color: INK,
            letterSpacing: "-2px",
            lineHeight: 1.05,
          },
          card.headline,
        ),
        ...(card.stateLabel === undefined
          ? []
          : [
              el(
                "div",
                {
                  fontSize: "26px",
                  fontWeight: 600,
                  color: BRAND,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                },
                card.stateLabel,
              ),
            ]),
        el("div", { fontSize: "34px", fontWeight: 500, color: MUTED }, card.subline),
      ]),
      el("div", { display: "flex", alignItems: "center", gap: "12px" }, [
        el(
          "div",
          { width: "28px", height: "28px", backgroundColor: BRAND, borderRadius: "999px" },
          "",
        ),
        el(
          "div",
          { fontSize: "26px", fontWeight: 600, color: INK, letterSpacing: "-0.3px" },
          "Mayarin Pay",
        ),
      ]),
    ],
  );
}

/** The fallback card for a missing, disabled, or voided document. */
export function genericCard(): OgCard {
  return {
    merchantName: "Mayarin Pay",
    headline: "Pay",
    subline: "Secure stablecoin checkout",
  };
}

/** Renders a card to a PNG buffer, the shape Hono's `c.body` accepts. */
export async function renderOgPng(card: OgCard): Promise<Uint8Array<ArrayBuffer>> {
  const svg = await satori(cardElement(card) as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: await fonts(),
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
  // `asPng()` is typed `Uint8Array<ArrayBufferLike>` (may be SharedArrayBuffer-backed),
  // which Hono's `c.body` rejects. Copy into a fresh ArrayBuffer-backed buffer.
  const copy = new Uint8Array(png.byteLength);
  copy.set(png);
  return copy;
}

/**
 * The card for a payment link. A fixed/catalog link shows its priced total; an
 * open link (no total until the buyer types one) shows its title, or "Pay
 * {merchant}" when it has none.
 */
export function linkCard(args: {
  readonly merchantName: string;
  readonly title: string | undefined;
  readonly total: Money | undefined;
}): OgCard {
  const { merchantName, title, total } = args;
  if (total === undefined) {
    return {
      merchantName,
      headline: title ?? `Pay ${merchantName}`,
      subline: "Enter an amount to pay",
    };
  }
  return {
    merchantName,
    headline: formatMoneyLocale(total, { trimZeroFraction: true, trimTrailingZeros: true }),
    subline: total.asset,
  };
}

/** The card for an invoice. Settled and voided invoices get a state label. */
export function invoiceCard(args: {
  readonly merchantName: string;
  readonly number: string | undefined;
  readonly status: InvoiceStatus;
  readonly outstanding: Money;
  readonly total: Money;
}): OgCard {
  const { merchantName, number, status, outstanding, total } = args;
  const ref = number === undefined ? "Invoice" : `Invoice ${number}`;
  if (status === "void") {
    return { merchantName, headline: ref, subline: "Voided", stateLabel: "Voided" };
  }
  if (outstanding.amount <= 0n) {
    return {
      merchantName,
      headline: formatMoneyLocale(total, { trimZeroFraction: true, trimTrailingZeros: true }),
      subline: `${ref} · settled`,
      stateLabel: "Settled",
    };
  }
  return {
    merchantName,
    headline: formatMoneyLocale(outstanding, { trimZeroFraction: true, trimTrailingZeros: true }),
    subline: `${ref} · outstanding in ${outstanding.asset}`,
  };
}
