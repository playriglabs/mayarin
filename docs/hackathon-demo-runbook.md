[← Back to the documentation index](./README.md)

# Hackathon Live Demo Runbook

**Demo date:** 23 August 2026  
**Core-demo time box:** 2:10, inside pitch-deck slide 4  
**Proof sentence:** IDR 36,000 priced. Testnet ETH paid. USDC settled. Chain and
ledger agree.

This is the stage script for the Mayarin end-to-end demo. Spoken lines are in
English for the Singapore jury. Text in brackets is an operator cue and is not
read aloud.

The primary demo uses the live **deposit path**: the payer sends ETH to a
per-payment address, then the executor settles USDC to the merchant. It is two
transactions, not one atomic transaction. The primary contract path is atomic,
but it is not the path shown in this demo.

## What the jury must remember

> The customer paid with the asset they held, the merchant received the asset
> they selected, and Mayarin proved the outcome across chain and merchant
> operations.

Do not turn the demo into a feature tour. Show only four proof moments:

1. The store price is IDR 36,000 and the payer selects ETH.
2. Mayarin locks an exact amount and issues a per-payment address.
3. The checkout moves from waiting to payment completed.
4. The merchant view shows net USDC, settlement proof, and webhook delivery.

## Roles

- **Presenter:** speaks, advances the deck, and controls the projected browser.
- **Payer/operator:** scans the QR and approves the Base Sepolia ETH transfer
  from a pre-funded phone wallet.
- If one person performs both roles, keep the phone unlocked and the wallet
  open before slide 4. Do not type an address on stage.

## Fill these before rehearsal

Keep secrets and login credentials in a password manager, never in this file.

| Item                                 | Stage value                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Prepared IDR 36,000 payment-link URL | `[PASTE INTO PRIVATE SHOW NOTES]`                                                                                   |
| Dashboard login                      | `[PASSWORD MANAGER ENTRY]`                                                                                          |
| Merchant payment-list URL            | `https://dashboard-testnet.mayarin.xyz/payments`                                                                    |
| Settlement URL                       | `https://dashboard-testnet.mayarin.xyz/settlement`                                                                  |
| Webhook deliveries URL               | `https://dashboard-testnet.mayarin.xyz/webhooks`                                                                    |
| Backup completed intent ID           | `pi_01M0D8X65WSYV0T5FQRQVXV5M7`                                                                                     |
| Backup payer transaction             | [`0xe031f84f…`](https://sepolia.basescan.org/tx/0xe031f84f710834cbbf1516f0dfad12c543933da7772799795235e93d21b7525e) |
| Backup settlement transaction        | [`0x41a87c05…`](https://sepolia.basescan.org/tx/0x41a87c05e673ed17b80ef5009813b932db74e095d4cdfca2c5dfdda49bee83c1) |
| Backup recording                     | `[LOCAL FILE, 45–60 SECONDS]`                                                                                       |

The prepared link should be a fixed **IDR 36,000** link for a Jakarta coffee
shop merchant, accept ETH on Base Sepolia, and settle in USDC. Do not use the
Parahyangan Supply storefront in the core demo unless the deck is also changed:
its apparel story and price do not match the coffee-shop claim on slide 4.

## Stage setup

Use one browser window with tabs in this exact order:

1. `mayarin.xyz/pitch-deck#4` — slide 4, speaker notes available.
2. Prepared live IDR 36,000 hosted checkout — not yet continued, ETH selected.
3. Dashboard payments — logged in and sorted newest first.
4. Settlement — logged in and sorted newest first.
5. Webhooks — Deliveries visible and sorted newest first.
6. Backup completed payment detail.
7. Backup payer transaction on Basescan.
8. Backup settlement transaction on Basescan.
9. Local backup recording, paused at its first frame.

Before the room opens:

- Close notifications, chat apps, password-manager popovers, and unrelated tabs.
- Use a clean browser profile at 100% zoom and a readable projected resolution.
- Log in to the dashboard and verify the session survives a refresh.
- Open the prepared payment link once; verify `IDR 36,000`, `ETH`, and
  `base-sepolia`, but do not press **Continue with ETH** yet.
- Confirm the phone wallet is on Base Sepolia and has enough ETH for the exact
  payment plus gas. Disable biometric surprises by unlocking it once.
- Confirm the merchant accepts ETH, settles in USDC, has an admitted settlement
  wallet, and has an active webhook endpoint.
- Complete one rehearsal payment. Record its intent ID, payer hash, settlement
  hash, merchant net, and webhook response.
- Test the recording offline. The backup must work with venue Wi-Fi disabled.

## The 2:10 live script

### 0:00–0:12 — Leave the deck

**Screen:** Slide 4, _Live payment demo_.

**Say:**

> Now let us make that concrete. This checkout is priced at IDR 36,000. The
> customer holds ETH, while the merchant only wants USDC.

**Do:** `[DEMO MOMENT — START LIVE DEMO]` Switch from the deck to the prepared
checkout tab. Keep the deck open at slide 4.

### 0:12–0:30 — Show the payer choice

**Screen:** Hosted checkout, with IDR 36,000 and ETH visible.

**Say:**

> The merchant keeps pricing in rupiah. The customer chooses ETH. Mayarin gives
> an estimate now and only locks the exact payment when we continue.

**Do:** Point once at the local price and ETH selection. Press **Continue with
ETH**. Do not explain every field.

### 0:30–0:48 — Show the locked instruction

**Screen:** _Complete your payment_, showing the exact ETH amount, QR, network,
address, and payment timeline.

**Say:**

> The quote is now locked. This address belongs to this payment, and the wallet
> must send this exact amount on Base Sepolia.

**Do:** The payer/operator scans the QR and approves the transaction. Keep the
checkout projected; do not project a private key, seed phrase, or full wallet
history.

### 0:48–1:20 — Let the system work visibly

**Screen:** Checkout timeline: _Waiting for payment_ → _Confirming_ → _Done_.

**Say while waiting:**

> The customer is making a plain wallet transfer. Mayarin watches the
> per-payment address, confirms the deposit, then the executor converts ETH to
> USDC and settles the merchant. The page updates automatically; there is no
> manual reconciliation step hidden behind this screen.

When **Payment detected** appears, say:

> The payer transfer has been detected. Settlement is now progressing.

When **Payment completed** appears, say:

> The payer side is complete. Now let us verify what the merchant received.

Never wait silently. If completion has not appeared 35 seconds after wallet
approval, use the amber fallback below.

### 1:20–1:43 — Show merchant clearing

**Screen:** Dashboard → **Payments** → newest payment.

**Say:**

> This is the same payment intent. The customer amount remains IDR 36,000, the
> payer rail is ETH, and clearing records the settlement, fee, and net USDC to
> the merchant.

**Do:** Open the newest payment. Point only at **State**, **Payer sends**,
**Received**, **Settlement**, **Fee**, **Net to merchant**, and the **Clearing
timeline**. Do not scroll through every field.

### 1:43–1:58 — Show settlement and delivery

**Screen:** Dashboard → **Settlement**, then **Webhooks**.

**Say:**

> Settlement is recorded against the merchant destination, and the signed
> webhook delivered the payment outcome to the merchant's system. Chain state
> and merchant operations now tell the same story.

**Do:** On Settlement, show the newest row and its reference. On Webhooks, show
the newest **DELIVERED** row and response code. If either page is still polling,
show the completed rehearsal record instead of waiting.

### 1:58–2:10 — Close the proof and return

**Screen:** The live proof link if it is ready; otherwise the two prepared
Basescan proof tabs. Then return to deck slide 5.

**Say:**

> Two transactions are visible here: the payer transfer and the settlement.
> Mayarin connects them to one payment record. Correct amount, merchant control,
> and a provable outcome.

**Do:** `[DEMO MOMENT — RETURN TO DECK, SLIDE 5]` Switch to the deck and advance
to slide 5, _The guarantees_.

## Fallback ladder

### Green — live payment completes

Finish the primary script. Use the new intent and new proof. Do not open the
backup recording.

### Amber — confirmation is taking longer than 35 seconds

Say:

> This is a public testnet, so confirmation time can vary. Rather than wait, I
> will show the last completed payment from this exact flow while this one
> continues in the background.

Switch to the prepared completed intent, then show its payer and settlement
transactions. Do not say the current payment completed. Return to slide 5 on
time.

### Red — wallet, quote provider, API, login, or venue network fails

Say:

> The live network is unavailable, so I will use the recorded run and then show
> its public chain proof.

Play the local 45–60 second recording. Finish on the two prepared Basescan
transactions, then return to slide 5. Do not debug on stage and do not retry a
wallet transfer whose status is unknown.

## Claim guardrails

Say:

- “Base Sepolia testnet,” never “mainnet” or “production volume.”
- “The merchant receives USDC,” not “the merchant receives IDR.”
- “Two transactions for the deposit path.”
- “The primary contract path is atomic; this wallet-transfer fallback is not.”
- “The executor briefly holds the payer asset on this fallback path.”

Do not say:

- “One atomic transaction” while showing this deposit-path demo.
- “Non-custodial throughout” for the deposit path.
- “Any token” or “any chain”; say “a supported asset.”
- “Guaranteed exchange rate forever”; the quote has a minimum and deadline.
- The exact ETH amount as market evidence. The testnet pool proves execution,
  not mainnet price quality.

## Fast answers after the demo

**Why are there two transactions?**  
The hosted checkout supports a plain wallet transfer. Mayarin first detects the
payer transfer, then the executor settles through `PaymentRouter`. The direct
contract path combines execution atomically.

**Where is custody?**  
On the demonstrated deposit path, the executor briefly controls the payer asset
between detection and settlement. We disclose that boundary. The primary
contract path has no resting balance.

**What is Mayarin beyond the checkout?**  
The checkout is one input. Mayarin is the clearing and merchant-operations
layer: quote, execution, settlement, ledger, reconciliation, and signed
webhooks.

## Final rehearsal gate

Run three rehearsals:

1. **Normal:** full live payment, target 2:00 and hard stop at 2:10.
2. **Slow-chain:** trigger the amber fallback at 35 seconds without hesitation.
3. **Offline:** Wi-Fi off, play the local recording, open saved proof, and
   return to slide 5.

The demo is stage-ready only when all three finish without exposing credentials
and the presenter can say the final proof line without looking at this file.
