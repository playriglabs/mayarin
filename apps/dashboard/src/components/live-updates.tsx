import { useEffect } from "react";
import { type LiveChannel, setLiveChannel } from "@/lib/live-updates";
import { queryClient } from "@/lib/query";

/**
 * The queries each stream refreshes.
 *
 * A payment moves more than the payments list: the overview's balance and its
 * "today" figure read analytics and the wallet balance, and analytics stops
 * polling once every payment it holds is terminal — so a new payment would
 * never reach them without this tick. Only mounted queries refetch.
 */
const CHANNELS: Record<LiveChannel, readonly (readonly unknown[])[]> = {
  payments: [["payments"], ["analytics"], ["wallets", "balance"]],
  "event-logs": [["event-logs"]],
};

export default function LiveUpdates() {
  useEffect(() => {
    if (!("EventSource" in window)) return;

    const streams = (Object.keys(CHANNELS) as LiveChannel[]).map((channel) => {
      const source = new EventSource(`/api/v1/${channel}/events`);
      source.onopen = () => setLiveChannel(channel, true);
      source.addEventListener("refresh", () => {
        for (const queryKey of CHANNELS[channel]) {
          void queryClient.invalidateQueries({ queryKey });
        }
      });
      source.onerror = () => setLiveChannel(channel, false);
      return { channel, source };
    });

    return () => {
      for (const { channel, source } of streams) {
        source.close();
        setLiveChannel(channel, false);
      }
    };
  }, []);

  return null;
}
