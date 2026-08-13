import { createRoot } from "react-dom/client";
import { Marketplace } from "./Marketplace.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html has no #root element");
}
createRoot(root).render(<Marketplace />);
