import { useState } from "preact/hooks";

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

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;

    setState({ status: "submitting" });
    const data = new FormData(form);

    try {
      const response = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), company: data.get("company") }),
      });
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
    }
  }

  return { state, submit, submitting: state.status === "submitting" } as const;
}
