export type validators_add_health_checkResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): validators_add_health_checkResult<T> {
  return { data, error: null };
}
