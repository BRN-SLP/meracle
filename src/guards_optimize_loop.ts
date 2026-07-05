export type guards_optimize_loopResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): guards_optimize_loopResult<T> {
  return { data, error: null };
}
