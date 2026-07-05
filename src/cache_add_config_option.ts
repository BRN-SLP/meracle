export type cache_add_config_optionResult<T> = {
  data: T | null;
  error: string | null;
};

export function wrapResult<T>(data: T): cache_add_config_optionResult<T> {
  return { data, error: null };
}
