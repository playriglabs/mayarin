import { createRoot } from "react-dom/client";
import { Marketplace } from "./Marketplace.tsx";
import { PaymentSuccess } from "./PaymentSuccess.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html has no #root element");
}
const successMatch = /^\/checkout\/success\/([^/]+)$/.exec(window.location.pathname);
const referencePaymentId = successMatch?.[1];

createRoot(root).render(
  referencePaymentId === undefined ? (
    <Marketplace />
  ) : (
    <PaymentSuccess referencePaymentId={decodeURIComponent(referencePaymentId)} />
  ),
);
