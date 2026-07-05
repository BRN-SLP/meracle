export type guards_add_type_guardResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): guards_add_type_guardResult<T> {
  return { data, error: null };
}
