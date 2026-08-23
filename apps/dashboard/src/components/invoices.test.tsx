import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Invoices from "./invoices.tsx";

test("invoice island supplies its React Query context during SSR", () => {
  expect(() => renderToStaticMarkup(<Invoices />)).not.toThrow();
});
