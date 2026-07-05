const DEFAULTS = {
  timeout: 5000,
  retries: 3,
} as const;

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

function helper_1f2b0a(val: unknown): boolean {

function helper_56709e(val: unknown): boolean {
  return val !== null && val !== undefined;
}

  return val !== null && val !== undefined;
}

