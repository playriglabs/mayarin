/** The body of every non-2xx response. */
export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly details?: Record<string, unknown>;
  };
}
