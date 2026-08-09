/**
 * Merchant wallet routes (#11).
 *
 * Behind `require-auth` + `settings:manage`, same as settlement settings: this
 * decides where a merchant's money can be paid.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import { UnauthorizedError } from "@mayarin/shared";
import { type MerchantWallet, PASSKEY_TRANSPORTS } from "@mayarin/wallet";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

const linkBodySchema = z.object({ chain: z.enum(CHAIN_IDS), address: z.string() }).strict();

const provisionBodySchema = z.object({ chain: z.enum(CHAIN_IDS) }).strict();

/**
 * A passkey the merchant's browser just created.
 *
 * Passed through to the provider, which validates the attestation. Validated
 * here only for shape: nothing is trusted on the strength of it, because the
 * address it produces becomes payable on a signature over a challenge this
 * deployment issued and not before.
 */
const passkeyBodySchema = z
  .object({
    chain: z.enum(CHAIN_IDS),
    attestation: z
      .object({
        name: z.string().min(1).max(64),
        credentialId: z.string().min(1),
        challenge: z.string().min(1),
        clientDataJson: z.string().min(1),
        attestationObject: z.string().min(1),
        transports: z.array(z.enum(PASSKEY_TRANSPORTS)).min(1),
      })
      .strict(),
  })
  .strict();

const verifyBodySchema = z
  .object({ challengeId: z.string().min(1), signature: z.string().min(1) })
  .strict();

function toWalletDto(wallet: MerchantWallet) {
  return {
    id: wallet.id,
    chain: wallet.chain,
    address: wallet.address,
    provenance: wallet.provenance,
    /** The only field that decides whether this address can be paid. */
    verified: wallet.verifiedAt !== undefined,
    verifiedAt: wallet.verifiedAt?.toISOString() ?? null,
    /**
     * Who else can sign for a managed wallet. Surfaced because "Mayarin is not
     * the sole signer" is a claim the merchant should be able to check rather
     * than take on trust — the signer set is on-chain either way.
     */
    signers:
      wallet.managed === undefined
        ? null
        : { merchant: wallet.managed.merchantSigner, mayarin: wallet.managed.address },
    /**
     * The provider organization a passkey key lives in.
     *
     * Surfaced because the merchant's browser needs it to sign: it talks to the
     * provider directly, stamping the request with the passkey, and has to name
     * the organization. Not a secret — holding the handle without the
     * authenticator does nothing, which is the same reason Mayarin can store it.
     */
    keyRef: wallet.keyRef ?? null,
    createdAt: wallet.createdAt.toISOString(),
  };
}

export function walletRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/", async (c) => {
    const wallets = await container.wallets.list(scopeOf(c));
    return c.json({ wallets: wallets.map(toWalletDto) });
  });

  app.post("/", csrfMiddleware(), async (c) => {
    const body = linkBodySchema.parse(await c.req.json());
    const wallet = await container.wallets.link(scopeOf(c), body.chain, body.address);
    return c.json({ wallet: toWalletDto(wallet) }, 201);
  });

  /**
   * Creates a key only this merchant's passkey can use.
   *
   * The wallet comes back unverified: the merchant signs the challenge with the
   * new key before it can be paid, or be a signer of a managed Safe. 201
   * because a key was created — unlike `/managed`, asking twice makes two.
   */
  app.post("/passkey", csrfMiddleware(), async (c) => {
    const body = passkeyBodySchema.parse(await c.req.json());
    const wallet = await container.wallets.createPasskeyWallet(
      scopeOf(c),
      body.chain,
      body.attestation,
    );
    return c.json({ wallet: toWalletDto(wallet) }, 201);
  });

  /**
   * Provisions a managed smart account for this merchant.
   *
   * Idempotent: a merchant who already has one gets it back, and an attempt
   * that died halfway resumes onto the same wallet rather than deploying a
   * second one. Returns 200 rather than 201 for that reason — the second call
   * created nothing.
   */
  app.post("/managed", csrfMiddleware(), async (c) => {
    const body = provisionBodySchema.parse(await c.req.json());
    const wallet = await container.wallets.provision(scopeOf(c), body.chain);
    return c.json({ wallet: toWalletDto(wallet) });
  });

  /** Issues the text to sign. Signing it moves no funds. */
  app.post("/:id/challenge", csrfMiddleware(), async (c) => {
    const { challenge, message } = await container.wallets.challenge(scopeOf(c), c.req.param("id"));
    return c.json({
      challengeId: challenge.id,
      message,
      expiresAt: challenge.expiresAt.toISOString(),
    });
  });

  app.post("/:id/verify", csrfMiddleware(), async (c) => {
    const body = verifyBodySchema.parse(await c.req.json());
    const wallet = await container.wallets.verify(
      scopeOf(c),
      c.req.param("id"),
      body.challengeId,
      body.signature,
    );
    return c.json({ wallet: toWalletDto(wallet) });
  });

  return app;
}
