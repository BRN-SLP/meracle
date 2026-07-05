export type utils_add_cache_layerResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): utils_add_cache_layerResult<T> {
  return { data, error: null };
}
