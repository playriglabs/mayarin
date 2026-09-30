/**
 * Batch payouts (#295), behind the merchant's own session.
 *
 * Two sources, two steps, and Mayarin signs in neither:
 *
 * - **safe** — from the managed Safe; only its owner key can submit it.
 * - **wallet** — from whichever wallet is connected, its own balance, through
 *   `PayoutBatcher` after an approval per token.
 *
 * 1. **prepare** — parse the file against the ERC-20s configured on that chain
 *    and hand back the transaction (and, for a wallet, the approvals).
 * 2. **record** — given the hash, read the receipt back off the chain and
 *    record the batch only if every row has its own `Transfer` out of the source.
 *
 * A stolen session can prepare a batch but not submit one: submitting needs a
 * key the merchant holds. That is why the managed signer's withdraw policy —
 * own verified wallets only — stays exactly as it was.
 */

import type { ChainId } from "@mayarin/chain";
import {
  type ParsedPayouts,
  type PayoutBatch,
  type PayoutBatchRepository,
  type PayoutSource,
  parsePayouts,
  payoutTotals,
  unmatchedRows,
} from "@mayarin/payouts";
import {
  type AssetCode,
  type Clock,
  ConfigurationError,
  generateId,
  type Money,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import { isVerified, type MerchantWallet, type MerchantWalletRepository } from "@mayarin/wallet";
import type { Scope } from "../dto/auth.ts";
import { type CursorPage, cursorPage, DEFAULT_PAGE_SIZE, decodeCursor } from "../pagination.ts";
import {
  batcherApprovals,
  batcherTransaction,
  PAYOUT_BATCHER,
  type PayoutApproval,
  type PayoutReceiptReader,
  type PayoutTransaction,
  payoutTransaction,
  type TokenAddresses,
} from "./payout-chain.ts";

export interface PayoutServiceOptions {
  readonly wallets: MerchantWalletRepository;
  readonly batches: PayoutBatchRepository;
  readonly receipts: PayoutReceiptReader;
  /** ERC-20 contracts per chain. A payout asset must be one of these. */
  readonly tokens: Readonly<Partial<Record<ChainId, TokenAddresses>>>;
  readonly clock: Clock;
}

export interface PreparedPayout extends ParsedPayouts {
  readonly totals: readonly Money[];
  /** Absent while any row has an error: a batch is sent whole or not at all. */
  readonly transaction: PayoutTransaction | undefined;
  /** For a wallet batch: the allowances to check, and grant where short, first. */
  readonly approvals: readonly PayoutApproval[];
}

export interface PayoutRequest {
  readonly chain: ChainId;
  readonly source: PayoutSource;
  /** The merchant's file, `address,amount,asset[,note]` per line. */
  readonly csv: string;
}

export class PayoutService {
  readonly #wallets: MerchantWalletRepository;
  readonly #batches: PayoutBatchRepository;
  readonly #receipts: PayoutReceiptReader;
  readonly #tokens: Readonly<Partial<Record<ChainId, TokenAddresses>>>;
  readonly #clock: Clock;

  constructor(options: PayoutServiceOptions) {
    this.#wallets = options.wallets;
    this.#batches = options.batches;
    this.#receipts = options.receipts;
    this.#tokens = options.tokens;
    this.#clock = options.clock;
  }

  async prepare(scope: Scope, request: PayoutRequest): Promise<PreparedPayout> {
    const tokens = this.#tokensOn(request.chain);
    const parsed = parsePayouts(request.csv, { assets: Object.keys(tokens) as AssetCode[] });
    const totals = payoutTotals(parsed.rows);
    const ready = parsed.errors.length === 0;

    if (request.source === "wallet") {
      return {
        ...parsed,
        totals,
        transaction: ready ? batcherTransaction(parsed.rows, tokens) : undefined,
        approvals: ready ? batcherApprovals(totals, tokens) : [],
      };
    }

    const { safe, owner } = await this.#safe(scope, request.chain);
    return {
      ...parsed,
      totals,
      transaction: ready ? payoutTransaction(safe, owner, parsed.rows, tokens) : undefined,
      approvals: [],
    };
  }

  /**
   * Records a submitted batch from the chain's own account of it.
   *
   * The file is sent again rather than remembered from `prepare`: nothing is
   * stored until the chain has spoken, so an abandoned preparation leaves no
   * trace, and what is recorded is exactly what was proved.
   */
  async record(
    scope: Scope,
    request: PayoutRequest & { readonly transactionHash: string },
  ): Promise<PayoutBatch> {
    if (!/^0x[\da-f]{64}$/i.test(request.transactionHash)) {
      throw new ValidationError("That is not a transaction hash", {
        transactionHash: request.transactionHash,
      });
    }
    const tokens = this.#tokensOn(request.chain);
    const parsed = parsePayouts(request.csv, { assets: Object.keys(tokens) as AssetCode[] });
    if (parsed.errors.length > 0) {
      throw new ValidationError("The payout file has errors", { errors: parsed.errors.length });
    }

    const receipt = await this.#receipts.receipt(request.chain, request.transactionHash, tokens);
    if (receipt === null) {
      throw new NotFoundError("That transaction is not on the chain yet", {
        transactionHash: request.transactionHash,
      });
    }
    // Where the money must have left, and the contract the transaction must
    // have called: the Safe itself, or the batcher spending the sender's funds.
    const { source, target } =
      request.source === "wallet"
        ? { source: receipt.from, target: PAYOUT_BATCHER.toLowerCase() }
        : await this.#safe(scope, request.chain).then(({ safe }) => ({
            source: safe,
            target: safe,
          }));
    if (!receipt.succeeded || receipt.to !== target) {
      throw new ValidationError("That transaction is not a successful payout", {
        transactionHash: request.transactionHash,
      });
    }
    const missing = unmatchedRows(parsed.rows, receipt.transfers, source);
    if (missing.length > 0) {
      throw new ValidationError("The chain has no transfer for some rows", {
        lines: missing.map((row) => row.line).join(","),
      });
    }

    const completedAt = this.#clock.now();
    return this.#batches.insert({
      id: generateId("pob", completedAt.getTime()),
      merchantId: scope.merchantId,
      chain: request.chain,
      sourceAddress: source,
      submittedBy: receipt.from,
      transactionHash: request.transactionHash.toLowerCase(),
      rows: parsed.rows,
      completedAt,
    });
  }

  async history(
    scope: Scope,
    filter: { readonly limit?: number; readonly cursor?: string } = {},
  ): Promise<CursorPage<PayoutBatch>> {
    const limit = Math.min(filter.limit ?? DEFAULT_PAGE_SIZE, 200);
    const cursor = decodeCursor(filter.cursor);
    const rows = await this.#batches.listRecent(
      scope.merchantId,
      limit + 1,
      cursor === undefined ? undefined : { id: cursor.id, completedAt: cursor.createdAt },
    );
    return cursorPage(rows, limit, (last) => ({ id: last.id, createdAt: last.completedAt }));
  }

  /** The merchant's managed Safe on this chain and the key of theirs that owns it. */
  async #safe(scope: Scope, chain: ChainId): Promise<{ safe: string; owner: string }> {
    const wallet: MerchantWallet | null = await this.#wallets.findManaged(scope.merchantId, chain);
    const owner = wallet?.managed?.merchantSigner;
    if (wallet === null || !isVerified(wallet) || owner === undefined) {
      throw new NotFoundError("You have no managed wallet on this network to pay out from", {
        chain,
      });
    }
    return { safe: wallet.address.toLowerCase(), owner: owner.toLowerCase() };
  }

  #tokensOn(chain: ChainId): TokenAddresses {
    const tokens = this.#tokens[chain];
    if (tokens === undefined || Object.keys(tokens).length === 0) {
      throw new ConfigurationError(`No payout assets are configured on ${chain}`, { chain });
    }
    return tokens;
  }
}
