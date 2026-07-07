export type utils_sanitize_inputResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): utils_sanitize_inputResult<T> {
  return { data, error: null };
}
