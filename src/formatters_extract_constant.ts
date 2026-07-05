export type formatters_extract_constantResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): formatters_extract_constantResult<T> {
  return { data, error: null };
}
