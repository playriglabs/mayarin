import { useState } from "preact/hooks";
import { Reveal } from "../components/reveal.tsx";
import { ArrowRight, Label } from "../components/ui.tsx";

type SubmissionState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "success"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export function EarlyAccess() {
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

  const submitting = state.status === "submitting";

  return (
    <section id="early-access" class="scroll-mt-16 border-y border-line bg-paper">
      <div class="shell grid gap-12 py-20 md:py-28 lg:grid-cols-[1fr_1.05fr] lg:items-end lg:gap-24">
        <Reveal>
          <Label>Early access</Label>
          <h2 class="mt-7 max-w-[14ch] text-[clamp(3rem,6vw,5rem)]">
            Build the payment for your market needs.
          </h2>
          <p class="mt-6 max-w-[48ch] text-lg leading-[1.65] text-slate">
            Tell us where to reach you. We will share sandbox access and help map your first
            checkout to Mayarin’s clearing layer.
          </p>
        </Reveal>

        <Reveal delay={100}>
          <form
            class="border border-line bg-white p-6 md:p-8"
            onSubmit={(event) => void submit(event)}
          >
            <label for="early-access-email" class="text-sm font-medium text-ink">
              Work email
            </label>
            <div class="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                id="early-access-email"
                name="email"
                type="email"
                required
                autocomplete="email"
                placeholder="you@company.com"
                disabled={submitting}
                class="h-13 min-w-0 flex-1 border border-line py-3 bg-paper px-4 text-base text-ink outline-none transition-colors duration-200 placeholder:text-slate focus:border-forest disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={submitting}
                class="btn-fill [--btn-fill:var(--color-accent)] inline-flex h-13 cursor-pointer items-center justify-center gap-2 bg-ink px-6 text-sm text-white hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 font-semibold"
              >
                {submitting ? "Joining…" : "Request access"}
                {!submitting && <ArrowRight />}
              </button>
            </div>

            <div class="hidden" aria-hidden="true">
              <label for="early-access-company">Company website</label>
              <input
                id="early-access-company"
                name="company"
                type="text"
                tabIndex={-1}
                autocomplete="off"
              />
            </div>

            <p class="mt-4 text-sm text-slate">
              No newsletter noise. We will only contact you about Mayarin access.
            </p>
            <p
              class={
                state.status === "error" ? "mt-4 text-sm text-red-700" : "mt-4 text-sm text-forest"
              }
              aria-live="polite"
            >
              {state.status === "success" || state.status === "error" ? state.message : ""}
            </p>
          </form>
        </Reveal>
      </div>
    </section>
  );
}
