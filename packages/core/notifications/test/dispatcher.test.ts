import { beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, generateId } from "@mayarin/shared";
import {
  DEFAULT_BACKOFF_SECONDS,
  type NotifiableEvent,
  replayed,
  verifyWebhook,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookDelivery,
  WebhookDispatcher,
  type WebhookEndpoint,
} from "../src/index.ts";
import {
  CapturingWebhookTransport,
  InMemoryWebhookCursor,
  InMemoryWebhookDeliveryRepository,
  InMemoryWebhookEndpointRepository,
  InMemoryWebhookOutbox,
} from "../testing/index.ts";

const START = new Date("2026-01-01T00:00:00.000Z");

let clock: FixedClock;
let outbox: InMemoryWebhookOutbox;
let cursor: InMemoryWebhookCursor;
let endpoints: InMemoryWebhookEndpointRepository;
let deliveries: InMemoryWebhookDeliveryRepository;
let transport: CapturingWebhookTransport;
let dispatcher: WebhookDispatcher;

beforeEach(() => {
  clock = new FixedClock(START);
  outbox = new InMemoryWebhookOutbox();
  cursor = new InMemoryWebhookCursor();
  endpoints = new InMemoryWebhookEndpointRepository();
  deliveries = new InMemoryWebhookDeliveryRepository();
  transport = new CapturingWebhookTransport();
  dispatcher = new WebhookDispatcher({
    outbox,
    cursor,
    endpoints,
    deliveries,
    transport,
    clock,
  });
});

let eventCounter = 0;

function event(overrides: Partial<NotifiableEvent> = {}): NotifiableEvent {
  eventCounter += 1;
  return {
    id: generateId("evt", START.getTime() + eventCounter),
    merchantId: "mrc_1",
    paymentIntentId: "pi_1",
    clearingTransactionId: "clr_1",
    type: "payment.state_changed",
    state: "SETTLED",
    sequence: 8,
    metadata: { orderId: "order-4711" },
    occurredAt: START,
    ...overrides,
  };
}

async function endpoint(overrides: Partial<WebhookEndpoint> = {}): Promise<WebhookEndpoint> {
  const value: WebhookEndpoint = {
    id: generateId("whe"),
    merchantId: "mrc_1",
    url: "https://merchant.example/webhooks",
    secret: "whsec_current",
    active: true,
    createdAt: START,
    updatedAt: START,
    ...overrides,
  };
  await endpoints.insert(value);
  return value;
}

describe("enqueue", () => {
  test("creates one delivery per active endpoint and skips inactive ones", async () => {
    await endpoint();
    await endpoint({ id: generateId("whe"), url: "https://merchant.example/second" });
    await endpoint({ id: generateId("whe"), active: false });
    outbox.add(event());
    transport.queue(200, 200);

    const result = await dispatcher.tick();

    expect(result.enqueued).toBe(2);
    expect(deliveries.all()).toHaveLength(2);
  });

  test("a second tick over the same events enqueues nothing new", async () => {
    await endpoint();
    outbox.add(event(), event());

    await dispatcher.tick();
    const again = await dispatcher.tick();

    expect(again.enqueued).toBe(0);
    expect(deliveries.all()).toHaveLength(2);
  });

  test("a replayed event maps onto the delivery it already has", async () => {
    await endpoint();
    const replayed = event();
    outbox.add(replayed);
    await dispatcher.tick();

    // A cursor reset re-reads the log from the start, as a recovery would.
    await cursor.set("");
    const result = await dispatcher.tick();

    expect(result.enqueued).toBe(0);
    expect(deliveries.all()).toHaveLength(1);
  });

  test("a merchant with no endpoint produces no delivery but the cursor still advances", async () => {
    outbox.add(event({ merchantId: "mrc_other" }));

    const result = await dispatcher.tick();

    expect(result.enqueued).toBe(0);
    expect(await cursor.get()).toBeDefined();
  });
});

describe("deliver", () => {
  test("a 2xx answer marks the delivery DELIVERED and the request verifies", async () => {
    const target = await endpoint();
    const source = event();
    outbox.add(source);

    const result = await dispatcher.tick();

    expect(result.delivered).toBe(1);
    const [delivery] = deliveries.all();
    expect(delivery?.status).toBe("DELIVERED");
    expect(delivery?.deliveredAt).toEqual(clock.now());

    const [request] = transport.requests;
    expect(request?.url).toBe(target.url);
    expect(request?.headers[WEBHOOK_ID_HEADER]).toBe(source.id);
    expect(
      verifyWebhook({
        header: request?.headers[WEBHOOK_SIGNATURE_HEADER] ?? "",
        body: request?.body ?? "",
        secrets: [target.secret],
        now: clock.now(),
      }),
    ).toBe(true);

    const payload = JSON.parse(request?.body ?? "{}");
    expect(payload.id).toBe(source.id);
    expect(payload.type).toBe("payment.state_changed");
    expect(payload.data.state).toBe("SETTLED");
    expect(payload.data.paymentIntentId).toBe("pi_1");
    expect(payload.data.sequence).toBe(8);
    expect(payload.data.metadata).toEqual({ orderId: "order-4711" });
  });

  test("a failure schedules a retry on the backoff schedule", async () => {
    await endpoint();
    outbox.add(event());
    transport.queue(500);

    const first = await dispatcher.tick();
    expect(first.retried).toBe(1);

    const [failed] = deliveries.all();
    expect(failed?.status).toBe("PENDING");
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastStatusCode).toBe(500);
    expect(failed?.nextAttemptAt).toEqual(
      new Date(clock.now().getTime() + (DEFAULT_BACKOFF_SECONDS[0] ?? 0) * 1_000),
    );

    // Not due yet: nothing is attempted.
    const idle = await dispatcher.tick();
    expect(idle.delivered + idle.retried + idle.dead).toBe(0);

    clock.advance((DEFAULT_BACKOFF_SECONDS[0] ?? 0) * 1_000);
    const second = await dispatcher.tick();
    expect(second.delivered).toBe(1);
    expect(transport.requests).toHaveLength(2);
  });

  test("every attempt sends identical bytes", async () => {
    await endpoint();
    outbox.add(event());
    transport.queue(500);

    await dispatcher.tick();
    clock.advance((DEFAULT_BACKOFF_SECONDS[0] ?? 0) * 1_000);
    await dispatcher.tick();

    const [first, second] = transport.requests;
    expect(second?.body).toBe(first?.body ?? "");
  });

  test("a transport error is recorded and retried", async () => {
    await endpoint();
    outbox.add(event());
    transport.queue(new Error("connect ECONNREFUSED"));

    const result = await dispatcher.tick();

    expect(result.retried).toBe(1);
    expect(deliveries.all()[0]?.lastError).toBe("connect ECONNREFUSED");
  });

  test("exhausting the schedule parks the delivery as DEAD", async () => {
    await endpoint();
    outbox.add(event());
    dispatcher = new WebhookDispatcher({
      outbox,
      cursor,
      endpoints,
      deliveries,
      transport,
      clock,
      backoffSeconds: [10, 20],
    });
    transport.queue(500, 500, 500);

    await dispatcher.tick();
    clock.advance(10_000);
    await dispatcher.tick();
    clock.advance(20_000);
    const last = await dispatcher.tick();

    expect(last.dead).toBe(1);
    const [delivery] = deliveries.all();
    expect(delivery?.status).toBe("DEAD");
    expect(delivery?.attempts).toBe(3);
    expect(transport.requests).toHaveLength(3);

    // DEAD is terminal: no further attempts however far time moves.
    clock.advance(1_000_000_000);
    await dispatcher.tick();
    expect(transport.requests).toHaveLength(3);
  });

  test("an endpoint switched off after enqueue parks its delivery as DEAD", async () => {
    const target = await endpoint();
    outbox.add(event());
    // First attempt fails, so a PENDING delivery exists when the endpoint is
    // switched off.
    transport.queue(500);
    await dispatcher.tick();
    await endpoints.update({ ...target, active: false });

    clock.advance((DEFAULT_BACKOFF_SECONDS[0] ?? 0) * 1_000);
    const result = await dispatcher.tick();

    expect(result.dead).toBe(1);
    const [delivery] = deliveries.all();
    expect(delivery?.status).toBe("DEAD");
    expect(delivery?.lastError).toBe("endpoint inactive");
    expect(transport.requests).toHaveLength(1);
  });

  test("a replayed delivery re-sends the same bytes under the same event id", async () => {
    await endpoint();
    outbox.add(event());
    await dispatcher.tick();

    const [delivered] = deliveries.all();
    expect(delivered?.status).toBe("DELIVERED");

    await deliveries.update(replayed(delivered as WebhookDelivery, clock.now()));
    const result = await dispatcher.tick();

    expect(result.delivered).toBe(1);
    const [first, second] = transport.requests;
    expect(second?.body).toBe(first?.body ?? "");
    expect(second?.headers[WEBHOOK_ID_HEADER]).toBe(first?.headers[WEBHOOK_ID_HEADER] ?? "");
  });

  test("signs with the previous secret too, so a mid-rotation receiver verifies", async () => {
    const target = await endpoint({ previousSecret: "whsec_old" });
    outbox.add(event());

    await dispatcher.tick();

    const [request] = transport.requests;
    expect(
      verifyWebhook({
        header: request?.headers[WEBHOOK_SIGNATURE_HEADER] ?? "",
        body: request?.body ?? "",
        secrets: ["whsec_old"],
        now: clock.now(),
      }),
    ).toBe(true);
    expect(
      verifyWebhook({
        header: request?.headers[WEBHOOK_SIGNATURE_HEADER] ?? "",
        body: request?.body ?? "",
        secrets: [target.secret],
        now: clock.now(),
      }),
    ).toBe(true);
  });
});
