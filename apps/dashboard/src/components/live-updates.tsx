import { useEffect } from "react";
import { CHANNEL_QUERIES, type LiveChannel, setLiveChannel } from "@/lib/live-updates";
import { queryClient } from "@/lib/query";

export default function LiveUpdates() {
  useEffect(() => {
    if (!("EventSource" in window)) return;

    const streams = (Object.keys(CHANNEL_QUERIES) as LiveChannel[]).map((channel) => {
      const source = new EventSource(`/api/v1/${channel}/events`);
      source.onopen = () => setLiveChannel(channel, true);
      source.addEventListener("refresh", () => {
        for (const queryKey of CHANNEL_QUERIES[channel]) {
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
