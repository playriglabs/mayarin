/** The attribution link. On the invoice it is the last thing on the page. */
export function PoweredBy({ className = "powered-by" }: { readonly className?: string }) {
  return (
    <a className={className} href="https://mayarin.xyz" target="_blank" rel="noreferrer">
      Powered by <strong>mayarin.xyz</strong>
    </a>
  );
}
