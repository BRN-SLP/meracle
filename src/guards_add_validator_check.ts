export type guards_add_validator_checkResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): guards_add_validator_checkResult<T> {
  return { data, error: null };
}
