export function listPath<T extends object>(path: string, filter: T, cursor?: string): string {
  const entries = Object.entries(filter).filter(
    (entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return value !== undefined && value !== null && value !== "";
    },
  );
  const params = new URLSearchParams(entries.map(([key, value]) => [key, String(value)]));
  if (cursor !== undefined) params.set("cursor", cursor);
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}
