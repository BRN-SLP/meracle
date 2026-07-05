export type sanitizers_optimize_loopResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): sanitizers_optimize_loopResult<T> {
  return { data, error: null };
}
