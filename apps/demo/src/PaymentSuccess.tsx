import { useEffect, useState } from "react";
import { recordSuccessfulPayment } from "./history.ts";

type PaymentState = "waiting" | "success" | "not-found" | "error";

interface PaymentStatusBody {
  readonly success?: boolean;
  readonly merchantName?: string;
  readonly amount?: { readonly display?: string };
  readonly payment?: { readonly asset?: string; readonly chain?: string } | null;
  readonly completedAt?: string | null;
  readonly merchantReference?: string | null;
}

interface PaymentDetails {
  readonly merchantName: string;
  readonly amountDisplay: string;
  readonly paidWith: string | null;
  readonly completedAt: string | null;
  readonly merchantReference: string | null;
}

function titleCaseChain(chain: string): string {
  return chain
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCompleted(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function readDetails(body: PaymentStatusBody): PaymentDetails | null {
  const merchantName = body.merchantName;
  const amountDisplay = body.amount?.display;
  if (merchantName === undefined || amountDisplay === undefined) return null;
  const payment = body.payment;
  const paidWith =
    payment !== null &&
    payment !== undefined &&
    typeof payment.asset === "string" &&
    typeof payment.chain === "string"
      ? `${payment.asset} on ${titleCaseChain(payment.chain)}`
      : null;
  return {
    merchantName,
    amountDisplay,
    paidWith,
    completedAt: typeof body.completedAt === "string" ? body.completedAt : null,
    merchantReference: typeof body.merchantReference === "string" ? body.merchantReference : null,
  };
}

export function PaymentSuccess({ referencePaymentId }: { readonly referencePaymentId: string }) {
  const [state, setState] = useState<PaymentState>("waiting");
  const [details, setDetails] = useState<PaymentDetails | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const response = await fetch(
          `/api/payment-status/${encodeURIComponent(referencePaymentId)}`,
        );
        if (response.status === 404) {
          setState("not-found");
          return;
        }
        const body = (await response.json()) as PaymentStatusBody;
        if (!response.ok) throw new Error("Could not verify payment");
        if (stopped) return;
        if (body.success === true) {
          recordSuccessfulPayment(referencePaymentId);
          setDetails(readDetails(body));
          setState("success");
        } else timer = setTimeout(() => void check(), 1_500);
      } catch {
        if (!stopped) setState("error");
      }
    };

    void check();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [referencePaymentId]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-5">
      <section className="w-full max-w-xl border border-ink bg-panel px-8 py-14 text-center sm:px-14">
        <p className="mb-3 text-xs font-bold tracking-[0.14em] text-ink uppercase">
          {details?.merchantName ?? "Parahyangan Supply"}
        </p>
        <div aria-live="polite">
          <h1 className="m-0 font-display text-4xl">
            {state === "success"
              ? "Payment successful"
              : state === "not-found"
                ? "Payment not found"
                : state === "error"
                  ? "Verification delayed"
                  : "Confirming your payment"}
          </h1>
          <p className="mx-auto my-5 max-w-md leading-7 text-ink-soft">
            {state === "success"
              ? "Thank you. Mayarin confirmed your payment and the merchant can now prepare your order."
              : state === "not-found"
                ? "This payment reference does not exist or is not available to this merchant. Check the link and try again."
                : state === "error"
                  ? "Your payment page reported completion, but this store could not verify the webhook yet. Please keep this reference."
                  : "The payment completed. We are waiting for the signed merchant webhook to arrive."}
          </p>
        </div>

        {state === "waiting" && (
          <p className="mb-5 inline-flex items-center gap-2 text-sm text-ink-soft">
            <span className="spinner" aria-hidden="true" />
            Verifying with the merchant…
          </p>
        )}

        {state === "success" && details !== null && (
          <dl className="mx-auto my-6 max-w-md space-y-3 border-y border-line py-5 text-left text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Amount</dt>
              <dd className="font-bold text-ink">{details.amountDisplay}</dd>
            </div>
            {details.paidWith !== null && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Paid with</dt>
                <dd className="font-bold text-ink">{details.paidWith}</dd>
              </div>
            )}
            {details.completedAt !== null && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Completed</dt>
                <dd className="text-ink">{formatCompleted(details.completedAt)}</dd>
              </div>
            )}
            {details.merchantReference !== null && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Order ref</dt>
                <dd className="wrap-anywhere text-ink">{details.merchantReference}</dd>
              </div>
            )}
          </dl>
        )}
        <code className="block wrap-anywhere bg-mist px-4 py-3 text-sm">{referencePaymentId}</code>
        <a
          className="mt-8 inline-flex min-h-12 items-center justify-center border border-ink bg-ink px-6 font-bold text-white no-underline transition-colors hover:border-accent hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          href="/"
        >
          Back to the marketplace
        </a>
      </section>
    </main>
  );
}
