export type utils_add_validator_checkResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): utils_add_validator_checkResult<T> {
  return { data, error: null };
}
