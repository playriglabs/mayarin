/**
 * The state of status.mayarin.xyz in one word. The status page does not allow
 * cross-origin reads, so the landing asks here instead. Uptime Kuma heartbeat
 * statuses: 0 down, 1 up, 2 pending, 3 maintenance.
 */
const HEARTBEATS = "https://status.mayarin.xyz/api/status-page/heartbeat/mayarin";

interface Heartbeats {
  readonly heartbeatList: Readonly<Record<string, readonly { readonly status: number }[]>>;
}

type State = "operational" | "issues" | "unknown";

function stateOf(data: Heartbeats): State {
  const latest = Object.values(data.heartbeatList).map((beats) => beats.at(-1)?.status);
  if (latest.length === 0 || latest.some((status) => status === undefined)) return "unknown";
  if (latest.some((status) => status === 0)) return "issues";
  return latest.every((status) => status === 1) ? "operational" : "unknown";
}

export const onRequestGet: PagesFunction = async () => {
  let state: State = "unknown";
  try {
    const response = await fetch(HEARTBEATS);
    if (response.ok) state = stateOf((await response.json()) as Heartbeats);
  } catch {
    // An unreachable status page is "unknown", not an outage claim.
  }
  return Response.json({ state }, { headers: { "Cache-Control": "public, max-age=60" } });
};
