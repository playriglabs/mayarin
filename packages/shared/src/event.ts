/**
 * Domain events.
 *
 * Mayarin is event driven: state changes are recorded as facts, and side effects
 * (webhooks, notifications, projections) subscribe to those facts instead of
 * being called inline by the clearing engine.
 *
 * Publishing is a port. Phase 1 ships an in-process bus; a queue-backed
 * publisher can replace it without touching a domain package.
 */

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly type: TType;
  /** Aggregate the event belongs to (payment intent id, clearing txn id, ...). */
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/** No-op publisher, for contexts that do not care about events (tests, scripts). */
export const noopEventPublisher: EventPublisher = {
  publish: async () => {},
};

/**
 * In-process event bus.
 *
 * Handler failures are isolated: one broken subscriber must never roll back a
 * settled payment. Failures are reported through `onHandlerError`.
 */
export class InMemoryEventBus implements EventPublisher {
  readonly #handlers = new Map<string, Set<EventHandler>>();
  readonly #wildcard = new Set<EventHandler>();
  readonly #onHandlerError: (error: unknown, event: DomainEvent) => void;

  constructor(onHandlerError?: (error: unknown, event: DomainEvent) => void) {
    this.#onHandlerError =
      onHandlerError ??
      ((error, event) => {
        console.error(`[events] handler failed for ${event.type}`, error);
      });
  }

  /** Subscribes to one event type, or to every event when type is "*". */
  subscribe(type: string, handler: EventHandler): () => void {
    if (type === "*") {
      this.#wildcard.add(handler);
      return () => this.#wildcard.delete(handler);
    }

    const handlers = this.#handlers.get(type) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.#handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      const handlers = [...(this.#handlers.get(event.type) ?? []), ...this.#wildcard];
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (error) {
          this.#onHandlerError(error, event);
        }
      }
    }
  }
}
