[← Documentation index](./README.md)

---

# Embeddable Checkout

`@mayarin/embed` (`packages/embed`) puts the hosted checkout on a merchant's
own page (#113). It is distribution, not domain: the embed calls no API route
of its own and imports nothing from `packages/core`. One script tag, one
element:

```html
<script type="module" src="https://your-host/mayarin-embed.js"></script>

<mayarin-checkout
  base-url="https://api.mayarin.xyz"
  link="plk_01J8Z3K4M5N6P7Q8R9S0T1U2V3"
></mayarin-checkout>
```

Build the script with `bun run --cwd packages/embed build`; it lands in
`packages/embed/dist/index.js`. Host it anywhere — it is a static file with no
dependencies. A bundler user can instead `import "@mayarin/embed"`, or import
`register` to pick the tag name.

## Attributes

| Attribute  | Required | Meaning                                                                           |
| ---------- | -------- | --------------------------------------------------------------------------------- |
| `base-url` | yes      | Origin of the payment API. A path prefix is kept; `javascript:` URLs are refused. |
| `link`     | yes      | The payment link id to check out.                                                 |
| `height`   | no       | Frame height. A bare number means pixels; default `640px`.                        |

A missing or malformed attribute renders a visible one-line message in place of
the checkout. The message is for the merchant wiring the embed — a visible
sentence gets fixed; a silently blank box ships.

## Isolation model

The iframe is the boundary, not the shadow root. The framed checkout is
cross-origin to the merchant's page, so the browser enforces both directions:
the merchant's CSS cannot restyle the checkout, and the checkout's DOM cannot
read the merchant's page. The shadow root only keeps the element's own sizing
and error styling out of the merchant's cascade.

The element holds no key. A payment link id is an unguessable ULID — the same
posture the hosted checkout page itself takes. The secret key never appears,
and there is nothing in the embed a browser could leak.

## What the merchant's CSP must allow

On a page with a strict Content-Security-Policy, the merchant must allow:

- `frame-src https://api.mayarin.xyz` (the payment API origin) — the checkout
  iframe.
- `script-src https://your-host` — wherever `mayarin-embed.js` is hosted, or a
  hash/nonce for it.

Nothing else. The embed itself makes no network request; every call happens
inside the frame, on the API's origin.

## Constraint on the API

The hosted checkout page must stay frameable. The API sets no
`X-Frame-Options` or `frame-ancestors` today; a future security-headers pass
must exempt `/checkout/*` (or scope `frame-ancestors` per merchant), or every
embed goes blank at once.

## Deliberate v1 limits

- **A link id is the only input.** Publishable keys (`pk_...`) now exist and a
  browser can mint from a cart payload through `@mayarin/sdk/browser` — but the
  element does not do it yet. A cart-payload attribute on the element is a
  follow-up on the embed.
- **No completion events.** The element does not tell the merchant's page that
  the payment settled; the buyer sees the outcome inside the frame, and the
  merchant's systems learn it from webhooks (#13). A `postMessage` status
  bridge is a follow-up and needs a change on the checkout page, not here.
- **WooCommerce plugin** — tracked separately in #113.
