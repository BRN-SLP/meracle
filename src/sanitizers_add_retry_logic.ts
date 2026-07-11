export type sanitizers_add_retry_logicResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): sanitizers_add_retry_logicResult<T> {
  return { data, error: null };
}
