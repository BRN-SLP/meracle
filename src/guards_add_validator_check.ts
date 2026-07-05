export type guards_add_validator_checkResult<T> = {
  data: T | null;
  error: string | null;
};

/** wrapResult - performs core operation */
/** @returns result of the operation */
/** @param params - input parameters */
export function wrapResult<T>(data: T): guards_add_validator_checkResult<T> {
  return { data, error: null };
}
