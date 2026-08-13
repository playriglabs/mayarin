const IMAGE_BY_KIND: Readonly<Record<string, string>> = {
  tee: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=82",
  hoodie:
    "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=82",
  flannel:
    "https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=1200&q=82",
  jacket:
    "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=82",
  cargo:
    "https://images.unsplash.com/photo-1479064555552-3ef4979f8908?auto=format&fit=crop&w=1200&q=82",
  cap: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=1200&q=82",
};

export function ProductImage({
  image,
  kind,
  name,
}: {
  readonly image: string | undefined;
  readonly kind: string | undefined;
  readonly tone?: string | undefined;
  readonly name: string;
}) {
  const fallback =
    kind === undefined ? IMAGE_BY_KIND.tee : (IMAGE_BY_KIND[kind] ?? IMAGE_BY_KIND.tee);
  const src = image ?? fallback;
  return (
    <img
      src={src}
      alt={name}
      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
      loading="lazy"
      decoding="async"
    />
  );
}
