import { useEffect, useState } from "react";

type PaymentState = "waiting" | "success" | "error";

export function PaymentSuccess({ referencePaymentId }: { readonly referencePaymentId: string }) {
  const [state, setState] = useState<PaymentState>("waiting");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const response = await fetch(
          `/api/payment-status/${encodeURIComponent(referencePaymentId)}`,
        );
        const body = (await response.json()) as { success?: boolean };
        if (!response.ok) throw new Error("Could not verify payment");
        if (stopped) return;
        if (body.success === true) setState("success");
        else timer = setTimeout(() => void check(), 1_500);
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
    <main className="grid min-h-screen place-items-center bg-cream p-5">
      <section className="w-full max-w-xl border border-line bg-paper px-8 py-14 text-center shadow-xl sm:px-14">
        <div
          className={`mx-auto mb-6 grid size-16 place-items-center rounded-full text-3xl text-white ${state === "success" ? "bg-sage" : "bg-terracotta"}`}
          aria-hidden="true"
        >
          {state === "success" ? "✓" : "…"}
        </div>
        <p className="mb-3 text-xs font-bold tracking-[0.14em] text-terracotta uppercase">
          Toko Demo
        </p>
        <h1 className="m-0 font-display text-4xl">
          {state === "success"
            ? "Payment successful"
            : state === "error"
              ? "Verification delayed"
              : "Confirming your payment"}
        </h1>
        <p className="mx-auto my-5 max-w-md leading-7 text-[#625b52]">
          {state === "success"
            ? "Thank you. Mayarin confirmed your payment and the merchant can now prepare your order."
            : state === "error"
              ? "Your payment page reported completion, but this store could not verify the webhook yet. Please keep this reference."
              : "The payment completed. We are waiting for the signed merchant webhook to arrive."}
        </p>
        <code className="block [overflow-wrap:anywhere] bg-[#eee7dc] px-4 py-3 text-sm">
          {referencePaymentId}
        </code>
        <a
          className="mt-8 inline-flex min-h-12 items-center justify-center border border-ink bg-ink px-6 font-bold text-white no-underline transition hover:bg-terracotta"
          href="/"
        >
          Back to the marketplace
        </a>
      </section>
    </main>
  );
}
