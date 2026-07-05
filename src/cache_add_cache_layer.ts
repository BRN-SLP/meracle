export async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  if (!controller) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
