/**
 * The x402 merchant example (#269): a route this server owns, sold per request.
 *
 * One middleware between Express and the handler does the whole job — an
 * unpaid request is answered with Mayarin's price in the standard
 * `PAYMENT-REQUIRED` header, a paid one is settled by Mayarin before the
 * handler runs, and a replayed signature is re-served without re-running it.
 *
 * Register `premium-content` in the dashboard first, then:
 * bun run dev            (MAYARIN_API_URL and PORT are optional for local use)
 */

import { createX402Gate } from "@mayarin/sdk";
import { x402Connect } from "@mayarin/sdk/x402/connect";
import express from "express";
import { RESOURCE_ID, RESOURCE_PATH, serverConfig } from "./config.ts";
import { paymentRequiredView } from "./paywall.ts";

const config = serverConfig();
const gate = createX402Gate({ baseUrl: config.mayarinApiUrl, resourceId: RESOURCE_ID });

const app = express();

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/", (_req, res) => {
  res
    .type("text/plain")
    .send(
      [
        "Mayarin x402 merchant example.",
        "",
        `GET /${RESOURCE_ID} costs money — try it without a payment and read the 402,`,
        "or pay it with any x402 client and see the report.",
        "GET /health check for health.",
      ].join("\n"),
    );
});

app.get(RESOURCE_PATH, x402Connect(gate, { paymentRequiredView }), (_req, res) => {
  // Everything before this line is the payment; everything after is what was bought.
  res.status(200).json({
    report: "The merchant's own handler ran, after Mayarin settled the payment.",
    servedAt: new Date().toISOString(),
  });
});

app.listen(config.port, () => {
  console.log(
    `x402 merchant example on http://localhost:${config.port} — ${RESOURCE_PATH} is paid`,
  );
});
