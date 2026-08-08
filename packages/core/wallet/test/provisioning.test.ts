/**
 * Managed provisioning tests (#11).
 *
 * The property under test is the one an operator cannot check by looking: a
 * merchant ends up with **exactly one** managed wallet, however many times
 * provisioning is attempted and wherever a previous attempt died. Zero is a
 * failure someone notices; two is a second address a payer might be told to pay
 * into, and nobody notices until the money is in the wrong one.
 *
 * So the crash cases assert on the provider's call log, not only on the result.
 * A test that checked the returned wallet would pass while a duplicate
 * sub-organization and a duplicate deployment sat behind it.
 */

import { describe, expect, test } from "bun:test";
import { FixedClock, ValidationError } from "@mayarin/shared";
import { ManagedWalletProvisioner, type MerchantWallet } from "../src/index.ts";
import { FakeWalletProvider, InMemoryMerchantWalletRepository } from "../testing/index.ts";

const MERCHANT = "mrc_1";
const CHAIN = "base-sepolia" as const;
const SIGNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-01-01T00:00:00.000Z");

function linked(overrides: Partial<MerchantWallet> = {}): MerchantWallet {
  return {
    id: "wlt_linked",
    merchantId: MERCHANT,
    chain: CHAIN,
    address: SIGNER,
    provenance: "linked",
    verifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup(options: { treasuryAddresses?: readonly string[] } = {}) {
  const wallets = new InMemoryMerchantWalletRepository();
  const provider = new FakeWalletProvider();
  const provisioner = new ManagedWalletProvisioner({
    wallets,
    provider,
    clock: new FixedClock(NOW),
    ...(options.treasuryAddresses === undefined
      ? {}
      : { treasuryAddresses: options.treasuryAddresses }),
  });
  return { wallets, provider, provisioner };
}

describe("provision", () => {
  test("creates a managed wallet around the merchant's verified address", async () => {
    const { wallets, provisioner } = setup();
    await wallets.insert(linked());

    const managed = await provisioner.provision(MERCHANT, CHAIN);

    expect(managed.provenance).toBe("provisioned");
    // Verified by construction: Mayarin deployed it with the merchant's own
    // verified address in the signer set, so there is no claim left to prove.
    expect(managed.verifiedAt).toEqual(NOW);
    expect(managed.managed?.merchantSigner).toBe(SIGNER);
  });

  test("refuses when the merchant has proved control of nothing", async () => {
    // A signer set assembled from an address the merchant merely claimed would
    // let anyone with `settings:manage` name a co-owner of a new wallet.
    const { provisioner } = setup();
    await expect(provisioner.provision(MERCHANT, CHAIN)).rejects.toBeInstanceOf(ValidationError);
  });

  test("refuses an unverified address as the merchant's signer", async () => {
    const { wallets, provisioner } = setup();
    const { verifiedAt: _unused, ...unverified } = linked();
    await wallets.insert(unverified);

    await expect(provisioner.provision(MERCHANT, CHAIN)).rejects.toBeInstanceOf(ValidationError);
  });

  test("refuses to provision onto a treasury address", async () => {
    // A fee recipient that is also a payout destination pays a merchant twice
    // and is invisible in the ledger. The derivation is deterministic, so a
    // throwaway run tells us the address the guarded one will land on.
    const rehearsal = setup();
    await rehearsal.wallets.insert(linked());
    const predicted = (await rehearsal.provisioner.provision(MERCHANT, CHAIN)).address;

    const guarded = setup({ treasuryAddresses: [predicted] });
    await guarded.wallets.insert(linked());

    await expect(guarded.provisioner.provision(MERCHANT, CHAIN)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(guarded.provider.deploys).toHaveLength(0);
  });

  test("asking twice is asking once", async () => {
    const { wallets, provider, provisioner } = setup();
    await wallets.insert(linked());

    const first = await provisioner.provision(MERCHANT, CHAIN);
    const second = await provisioner.provision(MERCHANT, CHAIN);

    expect(second.id).toBe(first.id);
    expect(second.address).toBe(first.address);
    // The second call did not touch the provider at all: a finished wallet is
    // returned before any effect is attempted.
    expect(provider.signers).toHaveLength(1);
    expect(provider.deploys).toHaveLength(1);
  });
});

describe("an interrupted provision", () => {
  test("resumes to one wallet when the deployment died", async () => {
    const { wallets, provider, provisioner } = setup();
    await wallets.insert(linked());

    provider.failOn = "deploy";
    await expect(provisioner.provision(MERCHANT, CHAIN)).rejects.toThrow();

    // The row exists and is unverified — on file, not payable.
    const pending = await wallets.findManaged(MERCHANT, CHAIN);
    if (pending === null) throw new Error("expected a pending managed wallet on file");
    expect(pending.verifiedAt).toBeUndefined();

    const resumed = await provisioner.provision(MERCHANT, CHAIN);

    expect(resumed.id).toBe(pending.id);
    expect(resumed.verifiedAt).toEqual(NOW);
    // One signer across both attempts: the second reused the one on file
    // instead of creating a sub-organization the first attempt already made.
    expect(provider.signers).toHaveLength(1);
    expect(await wallets.listByMerchant(MERCHANT)).toHaveLength(2);
  });

  test("adopts a wallet that was deployed before the crash", async () => {
    const { wallets, provider, provisioner } = setup();
    await wallets.insert(linked());

    // Deployed, then died before the row could be marked verified — the
    // window where a naive retry deploys a second wallet.
    const managedSigner = await provider.createManagedSigner(MERCHANT);
    const request = { merchantId: MERCHANT, chain: CHAIN, merchantSigner: SIGNER, managedSigner };
    const address = await provider.predictAddress(request);
    await provider.deploy(request);
    await wallets.insert({
      id: "wlt_pending",
      merchantId: MERCHANT,
      chain: CHAIN,
      address,
      provenance: "provisioned",
      managed: { ...managedSigner, merchantSigner: SIGNER },
      createdAt: NOW,
      updatedAt: NOW,
    });

    const resumed = await provisioner.provision(MERCHANT, CHAIN);

    expect(resumed.address).toBe(address);
    expect(resumed.verifiedAt).toEqual(NOW);
    // The second deploy call found the wallet already there and checked it
    // rather than making another.
    expect(provider.deploys).toEqual([address, address]);
    expect(provider.signers).toHaveLength(1);
  });

  test("refuses to resume onto a different merchant signer", async () => {
    // The address is derived from the signer set, so swapping the merchant's
    // signer silently moves the wallet and deploys a second one.
    const { wallets, provider, provisioner } = setup();
    await wallets.insert(linked());

    provider.failOn = "deploy";
    await expect(provisioner.provision(MERCHANT, CHAIN)).rejects.toThrow();

    // Another verified address arrives, and the one the wallet was derived
    // from stops being verified. Substituting the survivor would be the easy
    // thing to do and the wrong one.
    await wallets.insert(
      linked({ id: "wlt_linked_2", address: "0x3333333333333333333333333333333333333333" }),
    );
    const { verifiedAt: _unused, ...unverified } = linked();
    await wallets.update(unverified);

    await expect(provisioner.provision(MERCHANT, CHAIN)).rejects.toBeInstanceOf(ValidationError);
    expect(provider.deploys).toHaveLength(0);
  });
});

describe("managed and linked wallets together", () => {
  test("a merchant keeps both on one chain", async () => {
    // Connect-existing alongside managed: linking an address the merchant
    // already controls is not undone by provisioning, and neither replaces the
    // other. Which one is paid is the settlement address, decided separately.
    const { wallets, provisioner } = setup();
    await wallets.insert(linked());

    const managed = await provisioner.provision(MERCHANT, CHAIN);
    const all = await wallets.listByMerchant(MERCHANT);

    expect(all.map((entry) => entry.provenance).sort()).toEqual(["linked", "provisioned"]);
    expect(all.every((entry) => entry.verifiedAt !== undefined)).toBe(true);
    expect(managed.address).not.toBe(SIGNER);
  });
});
