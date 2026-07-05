export type sanitizers_memoize_fnResult<T> = {
  data: T | null;
  error: string | null;
};

/** wrapResult - performs core operation */
/** @returns result of the operation */
/** @param params - input parameters */
export function wrapResult<T>(data: T): sanitizers_memoize_fnResult<T> {
  return { data, error: null };
}
