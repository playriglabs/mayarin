import { useEffect } from "react";
import { type LiveChannel, setLiveChannel } from "@/lib/live-updates";
import { queryClient } from "@/lib/query";

const CHANNELS: readonly LiveChannel[] = ["payments", "event-logs"];

export default function LiveUpdates() {
  useEffect(() => {
    if (!("EventSource" in window)) return;

    const streams = CHANNELS.map((channel) => {
      const source = new EventSource(`/api/v1/${channel}/events`);
      source.onopen = () => setLiveChannel(channel, true);
      source.addEventListener("refresh", () => {
        void queryClient.invalidateQueries({ queryKey: [channel] });
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
