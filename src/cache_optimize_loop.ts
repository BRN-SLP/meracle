export type cache_optimize_loopResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): cache_optimize_loopResult<T> {
  return { data, error: null };
}
