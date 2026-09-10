import { describe, expect, test } from "bun:test";
import { createApiHarness } from "./harness.ts";

const merchant = { id: "mrc_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };
const buyer = {
  name: "PT Sumber Rejeki",
  email: "finance@sumberrejeki.co.id",
  taxId: "01.234.567.8-901.000",
};

const DAY = 86_400_000;
const dueAt = () => new Date(Date.now() + 30 * DAY).toISOString();

function invoiceBody(overrides: Record<string, unknown> = {}) {
  return {
    merchantId: merchant.id,
    merchant,
    buyer,
    currency: "IDR",
    lines: [
      { name: "Kopi arabika 1kg", unitPrice: { amount: "25000.00", asset: "IDR" }, quantity: 2 },
      { name: "Grinder", unitPrice: { amount: "75000.00", asset: "IDR" }, quantity: 1 },
    ],
    ...overrides,
  };
}

async function createDraft(harness: ReturnType<typeof createApiHarness>) {
  const { body } = await harness.request("POST", "/v1/invoices", { body: invoiceBody() });
  return body.invoice;
}

async function createIssued(harness: ReturnType<typeof createApiHarness>) {
  const draft = await createDraft(harness);
  const { body } = await harness.request("POST", `/v1/invoices/${draft.id}/issue`, {
    body: { dueAt: dueAt(), prefix: "INV", includeYear: true },
  });
  return body.invoice;
}

describe("POST /invoices", () => {
  test("creates an unnumbered draft and totals its lines", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/invoices", { body: invoiceBody() });

    expect(status).toBe(201);
    expect(body.invoice.state).toBe("draft");
    expect(body.invoice.number).toBeNull();
    expect(body.invoice.total.amount).toBe("12500000");
    expect(body.invoice.total.display).toBe("Rp 125.000,00");
    expect(body.invoice.buyer.taxId).toBe("01.234.567.8-901.000");
  });

  test("rejects an invoice with no lines", async () => {
    const harness = createApiHarness();
    const { status } = await harness.request("POST", "/v1/invoices", {
      body: invoiceBody({ lines: [] }),
    });
    expect(status).toBe(400);
  });

  test("replaying an idempotency key returns the first invoice", async () => {
    const harness = createApiHarness();
    const first = await harness.request("POST", "/v1/invoices", {
      body: invoiceBody(),
      headers: { "Idempotency-Key": "inv-key-1" },
    });
    const second = await harness.request("POST", "/v1/invoices", {
      body: invoiceBody(),
      headers: { "Idempotency-Key": "inv-key-1" },
    });

    expect(second.body.invoice.id).toBe(first.body.invoice.id);
  });
});

describe("POST /invoices/:id/issue", () => {
  test("allocates a number and freezes the document", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    expect(issued.state).toBe("issued");
    expect(issued.number).toMatch(/^INV\/\d{4}\/0001$/);
    expect(issued.issuedAt).not.toBeNull();
    expect(issued.dueAt).not.toBeNull();
  });

  test("numbers run in sequence for one merchant", async () => {
    const harness = createApiHarness();
    const first = await createIssued(harness);
    const second = await createIssued(harness);

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
  });

  test("an issued invoice refuses an edit", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    const { status, body } = await harness.request("PATCH", `/v1/invoices/${issued.id}`, {
      body: { notes: "too late" },
    });

    expect(status).toBe(409);
    expect(body.error.code).toBe("INVALID_STATE_TRANSITION");
  });

  test("a draft accepts an edit", async () => {
    const harness = createApiHarness();
    const draft = await createDraft(harness);

    const { status, body } = await harness.request("PATCH", `/v1/invoices/${draft.id}`, {
      body: {
        lines: [{ name: "Kopi", unitPrice: { amount: "25000.00", asset: "IDR" }, quantity: 1 }],
      },
    });

    expect(status).toBe(200);
    expect(body.invoice.total.amount).toBe("2500000");
  });
});

describe("POST /invoices/:id/list and /unlist", () => {
  test("opts an invoice into and out of public payable discovery", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);
    expect(issued.listed).toBe(false);

    const listed = await harness.request("POST", `/v1/invoices/${issued.id}/list`);
    const unlisted = await harness.request("POST", `/v1/invoices/${issued.id}/unlist`);

    expect(listed.status).toBe(200);
    expect(listed.body.invoice.listed).toBe(true);
    expect(unlisted.status).toBe(200);
    expect(unlisted.body.invoice.listed).toBe(false);
  });
});

describe("POST /invoices/:id/checkout", () => {
  test("mints an intent carrying the invoice number", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    const { status, body } = await harness.request("POST", `/v1/invoices/${issued.id}/checkout`, {
      headers: { "CF-IPCountry": "MY" },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent.merchantReference).toBe(issued.number);
    expect(body.paymentIntent.amount.amount).toBe("12500000");
    expect(body.paymentIntent.metadata.payerCountryCode).toBe("MY");
  });

  test("carries the payer's selected deposit rail into the intent", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    const { status, body } = await harness.request("POST", `/v1/invoices/${issued.id}/checkout`, {
      body: {
        payment: { asset: "USDC", chain: "base-sepolia" },
        executionPath: "deposit-match",
      },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent.payment).toEqual({ asset: "USDC", chain: "base-sepolia" });
    expect(body.paymentIntent.executionPath).toBe("deposit-match");
  });

  test("a draft cannot be paid", async () => {
    const harness = createApiHarness();
    const draft = await createDraft(harness);

    const { status } = await harness.request("POST", `/v1/invoices/${draft.id}/checkout`);
    expect(status).toBe(409);
  });

  test("a part payment leaves the balance outstanding", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    const paid = await harness.request("POST", `/v1/invoices/${issued.id}/checkout`, {
      body: { amount: { amount: "50000.00", asset: "IDR" } },
    });
    expect(paid.status).toBe(201);
    await harness.request("POST", `/v1/payment-intents/${paid.body.paymentIntent.id}/confirm`);

    const { body } = await harness.request("GET", `/v1/invoices/${issued.id}`);
    expect(body.invoice.status).toBe("partially_paid");
    expect(body.invoice.paid.amount).toBe("5000000");
    expect(body.invoice.outstanding.amount).toBe("7500000");
  });

  test("the second checkout bills the balance, not the whole invoice", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    const first = await harness.request("POST", `/v1/invoices/${issued.id}/checkout`, {
      body: { amount: { amount: "50000.00", asset: "IDR" } },
    });
    await harness.request("POST", `/v1/payment-intents/${first.body.paymentIntent.id}/confirm`);

    const second = await harness.request("POST", `/v1/invoices/${issued.id}/checkout`);
    expect(second.body.paymentIntent.amount.amount).toBe("7500000");

    await harness.request("POST", `/v1/payment-intents/${second.body.paymentIntent.id}/confirm`);
    const { body } = await harness.request("GET", `/v1/invoices/${issued.id}`);
    expect(body.invoice.status).toBe("paid");
    expect(body.invoice.outstanding.amount).toBe("0");
  });

  test("refuses more than is outstanding", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    const { status } = await harness.request("POST", `/v1/invoices/${issued.id}/checkout`, {
      body: { amount: { amount: "999000.00", asset: "IDR" } },
    });
    expect(status).toBe(400);
  });
});

describe("GET /invoices", () => {
  test("returns the derived figures with the document", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    const { body } = await harness.request("GET", `/v1/invoices/${issued.id}`);
    expect(body.invoice.status).toBe("issued");
    expect(body.invoice.paid.amount).toBe("0");
    expect(body.invoice.outstanding.amount).toBe("12500000");
    expect(body.invoice.url).toContain(`/invoices/${issued.id}/view`);
  });

  test("filters a merchant's invoices by state", async () => {
    const harness = createApiHarness();
    await createDraft(harness);
    await createIssued(harness);

    const drafts = await harness.request(
      "GET",
      `/v1/invoices?merchantId=${merchant.id}&state=draft`,
    );
    expect(drafts.body.invoices).toHaveLength(1);
    expect(drafts.body.invoices[0].state).toBe("draft");
  });

  test("an unknown invoice is a 404", async () => {
    const harness = createApiHarness();
    const { status } = await harness.request("GET", "/v1/invoices/inv_missing");
    expect(status).toBe(404);
  });
});

describe("POST /invoices/:id/void", () => {
  test("withdraws the document and refuses payment", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);

    const voided = await harness.request("POST", `/v1/invoices/${issued.id}/void`);
    expect(voided.status).toBe(200);
    expect(voided.body.invoice.state).toBe("void");
    // The number stays consumed: an auditor can explain a gap, not a reuse.
    expect(voided.body.invoice.number).toBe(issued.number);

    const paid = await harness.request("POST", `/v1/invoices/${issued.id}/checkout`);
    expect(paid.status).toBe(409);
  });
});

describe("GET /invoices/:id/view", () => {
  test("boots the document with the derived figures, and injects data rather than markup", async () => {
    const harness = createApiHarness();
    const { body: created } = await harness.request("POST", "/v1/invoices", {
      body: invoiceBody({ buyer: { name: "</script><script>alert(1)</script>" } }),
    });
    const { body } = await harness.request("POST", `/v1/invoices/${created.invoice.id}/issue`, {
      body: { dueAt: dueAt(), prefix: "INV" },
    });

    const page = await harness.requestBootstrap(`/invoices/${body.invoice.id}/view`);
    expect(page.status).toBe(200);
    expect(page.bootstrap.page).toBe("invoice");
    expect(page.bootstrap.number).toBe(body.invoice.number);
    // The derived figures ride along: a buyer's screen never re-derives what
    // is owed from the payments itself.
    expect(page.bootstrap.outstanding.display).toBe("Rp 125.000,00");
    expect(page.bootstrap.payable).toBe(true);
    expect(page.bootstrap.checkoutUrl).toContain(`/v1/invoices/${body.invoice.id}/checkout`);
    // Line totals are computed server-side: money is bigint minor units, and
    // the page renders display strings without doing arithmetic.
    expect(page.bootstrap.lines[0].lineTotal.display).toBe("Rp 50.000,00");
    // A buyer name that would close the script element is data, not markup.
    expect(page.text).not.toContain("<script>alert(1)</script>");
    expect(page.bootstrap.buyer.name).toBe("</script><script>alert(1)</script>");
  });

  test("a settled invoice is not payable", async () => {
    const harness = createApiHarness();
    const issued = await createIssued(harness);
    const paid = await harness.request("POST", `/v1/invoices/${issued.id}/checkout`);
    await harness.request("POST", `/v1/payment-intents/${paid.body.paymentIntent.id}/confirm`);

    const page = await harness.requestBootstrap(`/invoices/${issued.id}/view`);
    expect(page.bootstrap.status).toBe("paid");
    expect(page.bootstrap.payable).toBe(false);
    expect(page.bootstrap.outstanding.display).toBe("Rp 0,00");
  });
});
