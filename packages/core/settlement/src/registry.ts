import { ConfigurationError } from "@mayarr/shared";
import type { SettlementAdapter } from "./types.ts";

/**
 * Adapter registry.
 *
 * The single place that knows which providers a deployment has. Everything else
 * asks for an adapter by name, which is why adding a payment rail is a
 * registration, not a change to the clearing engine.
 */
export class SettlementAdapterRegistry {
  readonly #adapters = new Map<string, SettlementAdapter>();

  constructor(adapters: readonly SettlementAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: SettlementAdapter): this {
    if (this.#adapters.has(adapter.name)) {
      throw new ConfigurationError(`Settlement adapter "${adapter.name}" is already registered`, {
        name: adapter.name,
      });
    }
    this.#adapters.set(adapter.name, adapter);
    return this;
  }

  has(name: string): boolean {
    return this.#adapters.has(name);
  }

  get(name: string): SettlementAdapter {
    const adapter = this.#adapters.get(name);
    if (adapter === undefined) {
      throw new ConfigurationError(`No settlement adapter registered as "${name}"`, {
        name,
        available: this.names(),
      });
    }
    return adapter;
  }

  names(): string[] {
    return [...this.#adapters.keys()];
  }
}
