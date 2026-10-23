import { errorText } from "./ui.ts";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The value to send, or `null` when the field is empty or not an EVM address. */
export function validReturnAddress(value: string): string | null {
  const trimmed = value.trim();
  return EVM_ADDRESS.test(trimmed) ? trimmed : null;
}

/** Return addresses are EVM addresses; a Solana rail has none to offer. */
export function offersReturnAddress(chain: string | undefined): boolean {
  return chain !== undefined && !chain.startsWith("solana");
}

/**
 * Where to send the deposit back if the payment fails after the money arrived.
 *
 * Optional, and kept apart from the wallet a buyer connects for protection:
 * typing an address here must not turn protection on. Without one, a failed
 * payment's deposit is returned by hand.
 */
export function ReturnAddressField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const invalid = value.trim() !== "" && validReturnAddress(value) === null;
  return (
    <div className="mt-6">
      <label className="mb-2 block text-sm text-ink" htmlFor="return-address">
        Return address <span className="text-muted">· optional</span>
      </label>
      <input
        id="return-address"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="0x…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm text-ink"
      />
      <p className="mt-1.5 mb-0 text-xs leading-relaxed text-muted">
        If the payment fails after you have sent the funds, they go back to this address. Use a
        wallet you control, not an exchange deposit address.
      </p>
      {invalid && (
        <p className={errorText} role="alert">
          That is not a valid 0x address.
        </p>
      )}
    </div>
  );
}
