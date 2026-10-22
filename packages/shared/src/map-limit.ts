/**
 * `Array.map` for an async function, with at most `limit` calls in flight, results in the
 * order of the input.
 *
 * `Promise.all(items.map(fn))` starts every call at once, which for a call that is a few
 * RPC round trips means a burst a provider answers with 429; a `for` loop awaiting each
 * one pays every round trip in turn. A small limit is the middle: a pass over thirty-five
 * items at a hundred and fifty milliseconds a round trip is four waits, not thirty-five.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}
