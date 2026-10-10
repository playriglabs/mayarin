/** The attribution link, the last thing on every buyer page. */
export function PoweredBy({ className = "" }: { readonly className?: string }) {
  return (
    <a
      className={`mx-auto block w-fit text-sm text-subtle no-underline transition-colors hover:text-muted [&>strong]:font-medium ${className}`}
      href="https://mayarin.xyz"
      target="_blank"
      rel="noreferrer"
    >
      Powered by <strong>mayarin.xyz</strong>
    </a>
  );
}
