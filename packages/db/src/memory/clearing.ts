import type { ClearingEvent, ClearingRepository, ClearingTransaction } from "@mayarin/clearing";
import { isTerminalState } from "@mayarin/clearing";
import { ConcurrencyError, ConflictError } from "@mayarin/shared";

/**
 * In-memory clearing repository.
 *
 * State changes and their events are stored together, as the Postgres
 * implementation writes them in one database transaction.
 */
export class InMemoryClearingRepository implements ClearingRepository {
  readonly #byId = new Map<string, ClearingTransaction>();
  readonly #byPaymentIntentId = new Map<string, string>();
  readonly #events = new Map<string, ClearingEvent[]>();

  async insert(transaction: ClearingTransaction, events: readonly ClearingEvent[]): Promise<void> {
    if (this.#byId.has(transaction.id)) {
      throw new ConflictError(`Clearing transaction ${transaction.id} already exists`, {
        id: transaction.id,
      });
    }
    if (this.#byPaymentIntentId.has(transaction.paymentIntentId)) {
      throw new ConflictError(
        `Payment intent ${transaction.paymentIntentId} is already being cleared`,
        { paymentIntentId: transaction.paymentIntentId },
      );
    }

    this.#byId.set(transaction.id, transaction);
    this.#byPaymentIntentId.set(transaction.paymentIntentId, transaction.id);
    this.#events.set(transaction.id, [...events]);
  }

  async update(
    transaction: ClearingTransaction,
    expectedVersion: number,
    events: readonly ClearingEvent[],
  ): Promise<void> {
    const current = this.#byId.get(transaction.id);
    if (current === undefined) {
      throw new ConflictError(`Clearing transaction ${transaction.id} does not exist`, {
        id: transaction.id,
      });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(
        `Clearing transaction ${transaction.id} was modified concurrently`,
        {
          id: transaction.id,
          expectedVersion,
          actualVersion: current.version,
        },
      );
    }

    this.#byId.set(transaction.id, transaction);
    this.#events.get(transaction.id)?.push(...events);
  }

  async findById(id: string): Promise<ClearingTransaction | null> {
    return this.#byId.get(id) ?? null;
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<ClearingTransaction | null> {
    const id = this.#byPaymentIntentId.get(paymentIntentId);
    return id === undefined ? null : (this.#byId.get(id) ?? null);
  }

  async findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<ClearingTransaction | null> {
    for (const transaction of this.#byId.values()) {
      if (
        transaction.provider === provider &&
        transaction.providerReference === providerReference
      ) {
        return transaction;
      }
    }
    return null;
  }

  async listEvents(clearingTransactionId: string): Promise<ClearingEvent[]> {
    return [...(this.#events.get(clearingTransactionId) ?? [])].sort(
      (a, b) => a.sequence - b.sequence,
    );
  }

  async listResumable(limit: number): Promise<ClearingTransaction[]> {
    return [...this.#byId.values()]
      .filter((transaction) => !isTerminalState(transaction.state))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }
}
