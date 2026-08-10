import { useSyncExternalStore } from "react";

export type LiveChannel = "payments" | "event-logs";

type Listener = () => void;

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
