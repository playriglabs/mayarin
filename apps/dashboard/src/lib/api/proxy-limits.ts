/** Bounds on what the same-origin API proxy will carry (SEC-03). */

/** A request body past this is refused before it is sent upstream. */
export const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
/** A response body past this is cut off rather than streamed without bound. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
/** Time to first byte from the API; the body is bounded by size, not time. */
export const UPSTREAM_TIMEOUT_MS = 30_000;

/** Passes bytes through and errors the stream once `limit` is exceeded. */
export function capBytes(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) {
        controller.error(new RangeError("Body too large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
