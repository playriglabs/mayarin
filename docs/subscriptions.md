[← Documentation index](./README.md)

# Subscriptions

A merchant bills a customer every week, month or year (#296). **v1 is
send-to-pay**: each cycle is an ordinary invoice issued to the customer, and
emailed when they have an address. They pay it on any rail (contract,
deposit-match or x402), exactly like a one-off invoice. The clearing engine,
ledger, receipts (#293) and payment webhooks need nothing new. Auto-charge, an
allowance pulled each period, is a later collection method on the same
aggregate. It waits on gas sponsorship (#9).

## The schedule

`@mayarin/subscriptions` (pure) stores an **anchor** (the first billing date),
an interval and the number of cycles billed. The next billing date is
`billingDate(anchor, interval, billedCycles)`. It is derived every time and
never accumulated, so month-end clamping cannot drift. A subscription anchored
on 31 January bills on 28/29 February, then 31 March, then 30 April. Dates are
UTC calendar arithmetic.

| State       | Bills | Transition                                                        |
| ----------- | ----- | ----------------------------------------------------------------- |
| `active`    | yes   | `pause`, `cancel`                                                 |
| `paused`    | no    | `resume` skips every period missed while paused (no back-billing) |
| `cancelled` | no    | terminal                                                          |

## The billing tick

`SubscriptionService.tick()` runs every minute in the dashboard API process.
That process holds what a cycle needs: invoices, customers and the Resend
sender. For each active subscription that is due, the tick:

1. creates the cycle's invoice with idempotency key `${id}:${billingDate}`,
   `metadata.subscriptionId` and `metadata.customerId`, then issues it with
   `dueAt = now + daysUntilDue`;
2. emails it when the subscriber has an address, with the same key as the
   Resend delivery id;
3. advances `billedCycles` under the optimistic lock.

**One cycle bills one invoice and sends one email, however often the tick
runs.** A crash between steps replays into the same invoice and the same email,
then advances. A second instance that loses the lock skips the cycle. A
deployment with no email configured still bills; the merchant sends the link.
Any other email failure fails the cycle, and the next tick retries it.

Payments on a cycle carry `metadata.subscriptionId` (the invoice's metadata
rides onto its intents), so the existing `payment.*` webhooks already name the
subscription. `SUBSCRIPTION_METADATA_KEY` (`@mayarin/subscriptions`) names
the key for both surfaces.

The tick also tells the merchant's webhook endpoints that the cycle exists:
`subscription.cycle_created`, sent through the same signed, retried queue as
payment events, once the invoice is issued and before the email. The event `id`
is the cycle key, so a replayed tick queues nothing new; a failure to queue
fails the cycle and the next tick retries it.

| `data` field     | Meaning                                                  |
| ---------------- | -------------------------------------------------------- |
| `subscriptionId` | the subscription                                         |
| `customerId`     | the subscriber                                           |
| `invoiceId`      | the cycle's invoice                                      |
| `payUrl`         | the hosted invoice page, the same link the email carries |
| `amount`         | decimal string of the invoice total (`49000.00`)         |
| `asset`          | the invoice currency                                     |
| `dueAt`          | ISO timestamp, or `null`                                 |

## Public API (`apps/api`, secret key)

What a SaaS backend calls at signup. `SubscriptionApiService` writes the same
table the dashboard does and never bills: the dashboard API's tick bills every
active row, whichever surface created it.

| Route                                                    | Permission       | What it does                                      |
| -------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| `POST /v1/subscriptions`                                 | `catalog:manage` | Create from an inline `customer: { name, email }` |
| `GET /v1/subscriptions`                                  | any secret key   | The merchant's subscriptions, newest first        |
| `GET /v1/subscriptions/:id`                              | any secret key   | The subscription and every cycle's invoice view   |
| `POST /v1/subscriptions/:id/pause`, `/resume`, `/cancel` | `catalog:manage` | Lifecycle transitions; illegal ones answer 409    |

The subscriber arrives inline because a SaaS knows its user's email, not a
Mayarin customer id. `CustomerRepository.findByEmail` reuses the merchant's
customer with that email (one per email, by the unique index) or creates one,
so the dashboard shows one customer however many plans they hold. The email is
required here: every cycle is emailed. `daysUntilDue` defaults to 7.

Creation is not idempotent. A caller that may retry stores the returned id.
The SDK exposes the surface as `commerce.subscriptions`, and the integration
guide is `apps/docs/content/docs/guides/subscriptions.mdx`.

## Dashboard API (`catalog:manage`)

| Route                                                 | What it does                                   |
| ----------------------------------------------------- | ---------------------------------------------- |
| `GET /subscriptions`                                  | The merchant's subscriptions, newest first     |
| `POST /subscriptions`                                 | Create for a customer; `startAt` defaults now  |
| `GET /subscriptions/:id`                              | The subscription and every cycle's invoice     |
| `POST /subscriptions/:id/pause`, `/resume`, `/cancel` | Lifecycle transitions; illegal ones answer 409 |
