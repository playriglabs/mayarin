[← Slides 1–4](./hackathon-speaker-script.md) ·
[Backup-slide answers →](./hackathon-speaker-script-backups.md)

# Hackathon Speaker Script — Slides 5–7

- **Recommended speaker, slides 5–6:** Citra
- **Recommended speaker, slide 7:** Rizky
- **Target time:** 2:35

Everything inside a blockquote is spoken. Text in brackets is a stage cue and
is not read aloud.

## Return from the live demo

`[Citra closes the demo, returns to the deck, and advances to slide 5.]`

> That payment gives us more than a successful checkout. It gives us three
> concrete guarantees.

## Slide 5 — The guarantees · 0:55

> First, the correct amount. The quote carries a signed settlement minimum and
> a deadline. If execution falls below that lock, PaymentRouter reverts instead
> of silently underpaying the merchant.
>
> Second, merchant control. Settlement can only reach an admitted merchant
> wallet. On our primary contract path, Mayarin receives, swaps, and settles in
> one atomic call, with no balance left resting in the contract.
>
> Third, a provable outcome. Confirmed chain events create balanced ledger
> entries, reconciliation, and signed merchant webhooks.
>
> The live demo used our plain-transfer deposit path, which has two
> transactions. Both paths converge on the same clearing and accounting model;
> only the primary contract path is atomic throughout.

`[Pause after “atomic throughout.” Advance to slide 6.]`

## Slide 6 — Merchant-ready product · 1:00

> This is why Mayarin is not just a checkout screen.
>
> For buyers, we provide payment links, printable QR codes, and hosted or
> embedded checkout.
>
> For merchants, the operation is already connected: catalog, orders, payment
> timeline, settlement, wallet, analytics, and audit views all read from real
> endpoints.
>
> For developers, there is a REST API, a TypeScript SDK, WooCommerce support,
> signed webhooks, and delivery inspection.
>
> Together, those surfaces follow one operational outcome: payment completed,
> settlement matched, and webhook delivered. Our next evidence is a controlled
> design-partner pilot with merchants in Southeast Asia.

`[Turn toward Rizky before advancing.]`

> And to close, I will hand it back to Rizky.

`[HAND BACK TO RIZKY. Advance to slide 7.]`

## Slide 7 — Team and the ask · 0:40

> Mayarin was built end to end by a small team. I am Rizky, leading research
> and development, and Citra is our core contributor and software engineer.
>
> We are now looking for three things: design-partner merchants for a controlled
> pilot, ecosystem partners who can strengthen the payment rail, and rigorous
> custody and security review before mainnet.
>
> Price locally. Pay globally. Settle predictably.
>
> Thank you.

`[Stop. Hold the final slide. Do not start filling the silence.]`

## Delivery reminders

- Citra should connect slide 5 directly to what the jury just saw; do not
  restart the pitch after the demo.
- On slide 5, clearly separate the two-transaction deposit demo from the atomic
  primary contract path.
- On slide 6, group the product by buyer, merchant, and developer. Do not list
  every dashboard page mechanically.
- Rizky should make eye contact before the ask and pause before the final line.
- Do not say the controlled pilot is already live or imply Mayarin is mainnet
  ready.

## Emergency short version · 1:10

> What you just saw produces three guarantees: the quote protects the correct
> settlement amount, payment can only reach an admitted merchant wallet, and
> the chain event drives a balanced ledger and signed webhook.
>
> Mayarin is already more than checkout. Buyers get links, QR, and hosted or
> embedded payment. Merchants get payment and settlement operations. Developers
> get an API, SDK, WooCommerce integration, and webhooks.
>
> This small team built that stack end to end. We are looking for
> design-partner merchants, ecosystem partners, and rigorous custody review for
> a controlled pilot.
>
> Price locally. Pay globally. Settle predictably. Thank you.
