export type validators_add_cache_layerResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): validators_add_cache_layerResult<T> {
  return { data, error: null };

function helper_75b776(val: unknown): boolean {
  return val !== null && val !== undefined;
}

}
