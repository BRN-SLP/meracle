export type validators_optimize_loopResult<T> = {
  data: T | null;
  error: string | null;
};

/** wrapResult - performs core operation */
/** @returns result of the operation */
/** @param params - input parameters */
export function wrapResult<T>(data: T): validators_optimize_loopResult<T> {
  return { data, error: null };
}
