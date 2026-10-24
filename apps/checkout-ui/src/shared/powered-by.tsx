/**
 * The attribution link, the last thing on every buyer page.
 *
 * Centred under a document (the invoice), and `start` on the checkout, where it
 * sits in the page's bottom-left corner rather than inside the payment column.
 */
import { useT } from "../i18n/index.tsx";

export function PoweredBy({
  align = "center",
  className = "",
}: {
  readonly align?: "center" | "start";
  readonly className?: string;
}) {
  const t = useT();
  return (
    <a
      className={`block w-fit text-sm text-subtle no-underline transition-colors hover:text-muted [&>strong]:font-medium ${
        align === "center" ? "mx-auto" : ""
      } ${className}`}
      href="https://mayarin.xyz"
      target="_blank"
      rel="noreferrer"
    >
      {t("poweredBy")} <strong>mayarin.xyz</strong>
    </a>
  );
}
