export type helpers_improve_error_handlingResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): helpers_improve_error_handlingResult<T> {
  return { data, error: null };
}
