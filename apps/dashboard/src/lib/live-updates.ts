import { useSyncExternalStore } from "react";

export type LiveChannel = "payments" | "event-logs";

type Listener = () => void;

/**
 * The queries each stream refreshes.
 *
 * The server sends `refresh` every three seconds whether or not anything changed, so what is
 * listed here is re-read that often for as long as the page is open. That suits the payments list
 * and the analytics behind "today": cheap database reads that stop polling once every payment is
 * terminal. It does not suit the wallet balance, which is an on-chain read across every chain
 * (about two seconds from a far region, one RPC round trip per chain) and was being repeated
 * every tick. The balance is read when a page mounts, and again after a withdrawal invalidates it.
 * Only mounted queries refetch.
 */
export const CHANNEL_QUERIES: Record<LiveChannel, readonly (readonly unknown[])[]> = {
  payments: [["payments"], ["analytics"]],
  "event-logs": [["event-logs"]],
};

const connected: Record<LiveChannel, boolean> = {
  payments: false,
  "event-logs": false,
};

const listeners = new Set<Listener>();

export function setLiveChannel(channel: LiveChannel, value: boolean): void {
  if (connected[channel] === value) return;
  connected[channel] = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLiveChannel(channel: LiveChannel): boolean {
  return useSyncExternalStore(
    subscribe,
    () => connected[channel],
    () => false,
  );
}
