/**
 * The state of the UptimeRobot status page in one word. The API key is a
 * read-only one and stays on the server, so the landing asks here instead of
 * calling UptimeRobot from the browser. UptimeRobot monitor statuses:
 * 0 paused, 1 not checked yet, 2 up, 8 seems down, 9 down.
 */
interface Env {
  readonly UPTIMEROBOT_API_KEY?: string;
}

interface Monitors {
  readonly monitors?: readonly { readonly status: number }[];
}

type State = "operational" | "issues" | "unknown";

function stateOf(data: Monitors): State {
  const statuses = (data.monitors ?? []).map((monitor) => monitor.status);
  if (statuses.length === 0) return "unknown";
  if (statuses.some((status) => status === 8 || status === 9)) return "issues";
  return statuses.every((status) => status === 2) ? "operational" : "unknown";
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  let state: State = "unknown";
  if (env.UPTIMEROBOT_API_KEY !== undefined) {
    try {
      const response = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ api_key: env.UPTIMEROBOT_API_KEY, format: "json" }),
      });
      if (response.ok) state = stateOf((await response.json()) as Monitors);
    } catch {
      // An unreachable status API is "unknown", not an outage claim.
    }
  }
  return Response.json({ state }, { headers: { "Cache-Control": "public, max-age=60" } });
};
