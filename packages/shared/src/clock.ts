/**
 * Clock port.
 *
 * Expiry, timeouts and retry backoff are domain behaviour, so time is injected
 * rather than read from the ambient environment. Tests drive a `FixedClock`.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FixedClock implements Clock {
  #current: Date;

  constructor(start: Date | string | number = 0) {
    this.#current = new Date(start);
  }

  now(): Date {
    return new Date(this.#current);
  }

  advance(milliseconds: number): this {
    this.#current = new Date(this.#current.getTime() + milliseconds);
    return this;
  }

  set(value: Date | string | number): this {
    this.#current = new Date(value);
    return this;
  }
}
