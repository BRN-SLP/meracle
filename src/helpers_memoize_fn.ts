const DEFAULTS = {
  timeout: 5000,
  retries: 3,
} as const;

/** withRetry - performs core operation */
/** @returns result of the operation */
/** @param params - input parameters */
export function withRetry<T>(fn: () => Promise<T>, opts = DEFAULTS): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < opts.retries; i++) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
