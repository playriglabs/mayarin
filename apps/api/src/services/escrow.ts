/**
 * Escrow view of a payment (#304).
 *
 * Reads the terms the order was signed against, asks the chain where the funds
 * are, and hands back the calldata for each action. Mayarin submits nothing
 * here: the payer, the merchant or the arbiter sends the call from their own
 * wallet, and the factory decides whether they may.
 */

import type { ChainId } from "@mayarin/chain";
import {
  type EscrowAction,
  type EscrowState,
  type EscrowTerms,
  escrowAddress,
  escrowCalldata,
  readEscrowState,
} from "@mayarin/provider-evm";
import { ConfigurationError, NotFoundError } from "@mayarin/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import type { PaymentAppService } from "./payment.ts";

export interface EscrowView {
  readonly chain: ChainId;
  readonly factory: string;
  readonly address: string;
  readonly token: string;
  readonly terms: EscrowTerms;
  readonly state: EscrowState;
  /** Calldata per action, sent to `factory`. Who may send it is the contract's rule. */
  readonly calls: Readonly<Record<EscrowAction, `0x${string}`>>;
}

export class EscrowService {
  readonly #payments: PaymentAppService;
  readonly #rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(payments: PaymentAppService, rpcUrls: Readonly<Partial<Record<ChainId, string>>>) {
    this.#payments = payments;
    this.#rpcUrls = rpcUrls;
  }

  async view(paymentId: string): Promise<EscrowView> {
    const { intent, transaction } = await this.#payments.getPayment(paymentId);
    const order = transaction?.contract?.order;
    const chain = intent.payment?.chain;
    if (order?.escrow === undefined || chain === undefined) {
      throw new NotFoundError(`Payment ${paymentId} is not held in escrow`, { paymentId });
    }

    const { factory, payer, payee, arbiter, releaseAfter } = order.escrow;
    const terms: EscrowTerms = {
      intentId: order.intentId as `0x${string}`,
      payer,
      payee,
      arbiter,
      releaseAfter,
    };
    const token = order.settlementToken;

    return {
      chain,
      factory,
      address: escrowAddress(terms, factory),
      token,
      terms,
      state: await readEscrowState(this.#client(chain), terms, token, factory),
      calls: {
        release: escrowCalldata("release", terms, token),
        refund: escrowCalldata("refund", terms, token),
        dispute: escrowCalldata("dispute", terms, token),
      },
    };
  }

  #client(chain: ChainId): PublicClient {
    const existing = this.#clients.get(chain);
    if (existing !== undefined) return existing;
    const rpcUrl = this.#rpcUrls[chain];
    if (rpcUrl === undefined) {
      throw new ConfigurationError(`No RPC URL for ${chain}; escrow state cannot be read`, {
        chain,
      });
    }
    const client = createPublicClient({ transport: http(rpcUrl) });
    this.#clients.set(chain, client);
    return client;
  }
}
