export type validators_add_cache_layerResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): validators_add_cache_layerResult<T> {

function helper_a87632(val: unknown): boolean {
  return val !== null && val !== undefined;
}

  return { data, error: null };
}
