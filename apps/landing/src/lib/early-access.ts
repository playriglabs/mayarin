import { useEffect, useRef, useState } from "preact/hooks";

export type SubmissionState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "success"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

/**
 * One submission path for every early-access form on the site — the section on
 * the landing page and the capture in the footer post to the same endpoint, so
 * the fetch and its states live here rather than being written twice.
 */
export function useEarlyAccess() {
  const [state, setState] = useState<SubmissionState>({ status: "idle" });
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);
  const retryAt = useRef(0);

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = window.setInterval(() => {
      setCooldown(Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown > 0]);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    if (inFlight.current || Date.now() < retryAt.current || state.status === "success") return;

    inFlight.current = true;
    retryAt.current = Date.now() + 60_000;
    setCooldown(60);
    setState({ status: "submitting" });
    const data = new FormData(form);

    try {
      const response = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), company: data.get("company") }),
      });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 600;
        retryAt.current = Date.now() + seconds * 1000;
        setCooldown(seconds);
      }
      const payload: unknown = await response.json();
      const message =
        typeof payload === "object" && payload !== null && "message" in payload
          ? String(payload.message)
          : undefined;

      if (!response.ok) {
        setState({ status: "error", message: message ?? "Could not join. Please try again." });
        return;
      }

      form.reset();
      setState({ status: "success", message: message ?? "You are on the early-access list." });
    } catch {
      setState({ status: "error", message: "Could not connect. Please try again." });
    } finally {
      inFlight.current = false;
    }
  }

  return {
    state,
    submit,
    cooldown,
    submitting: state.status === "submitting",
    disabled: state.status === "submitting" || state.status === "success" || cooldown > 0,
  } as const;
}
