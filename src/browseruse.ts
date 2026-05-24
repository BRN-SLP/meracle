/**
 * Browser Use Cloud client, thin wrapper around the v3 REST API.
 *
 * Spins up a remote chromium with a residential proxy, returns its
 * CDP WebSocket URL so a local Playwright client can connect over
 * CDP. Used by the UK scraper to bypass Akamai/Cloudflare bot
 * protection on Sainsbury's, Tesco, etc.
 *
 * Free tier (no card) gives "Free browsers" credits + 3 concurrent
 * sessions, plenty for one 5-minute UK scrape per day.
 *
 * API docs: https://docs.browser-use.com/cloud/api-reference
 */
import { z } from "zod";

import { env } from "./env.js";

const API_BASE = "https://api.browser-use.com/api/v3";

/**
 * ISO-3166-1 alpha-2 country code, LOWERCASE, matching the Browser
 * Use enum (`gb`, `de`, `fr`, ...).
 */
export type ProxyCountryCode =
  | "gb"
  | "us"
  | "de"
  | "fr"
  | "es"
  | "it"
  | "nl"
  | "se"
  | "ie";

const SessionResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  cdpUrl: z.string().nullable(),
  liveUrl: z.string().nullable(),
  startedAt: z.string().optional(),
  timeoutAt: z.string().optional(),
});

export type BrowserUseSession = z.infer<typeof SessionResponseSchema>;

export class BrowserUseError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(`Browser Use API ${status}: ${bodyText.slice(0, 200)}`);
  }
}

function requireApiKey(): string {
  if (!env.BROWSER_USE_API_KEY) {
    throw new Error(
      "BROWSER_USE_API_KEY is not set. Get a free key (no card) at " +
        "https://cloud.browser-use.com/settings?tab=api-keys&new=1 and " +
        "add it to .env (and the GitHub Actions secret of the same name " +
        "if you want the daily cron to scrape UK).",
    );
  }
  return env.BROWSER_USE_API_KEY;
}

async function callApi(
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const apiKey = requireApiKey();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new BrowserUseError(res.status, text);
  }
  return text.length > 0 ? JSON.parse(text) : null;
}

/**
 * Create a remote chromium session.
 *
 *   timeoutMinutes — max session lifetime (defaults to 5 for cheap
 *   ephemeral scrapes). Free tier credits are limited, keep this
 *   short.
 */
export async function createSession(
  proxyCountry: ProxyCountryCode,
  timeoutMinutes = 5,
): Promise<BrowserUseSession> {
  const raw = await callApi("/browsers", {
    method: "POST",
    body: JSON.stringify({
      proxyCountryCode: proxyCountry,
      timeout: timeoutMinutes,
    }),
  });
  const session = SessionResponseSchema.parse(raw);
  if (!session.cdpUrl) {
    throw new Error(
      `Browser Use returned a session with no cdpUrl: ${session.id}`,
    );
  }
  return session;
}

/**
 * Stop a session explicitly. The session also auto-stops on its
 * timeout, but calling stop() lets us release credits as soon as the
 * scrape finishes.
 */
export async function stopSession(sessionId: string): Promise<void> {
  await callApi(`/browsers/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "stop" }),
  });
}

/**
 * Convenience wrapper: spin up a session, run the callback against
 * its cdpUrl, ensure the session is stopped no matter what.
 */
export async function withSession<T>(
  proxyCountry: ProxyCountryCode,
  timeoutMinutes: number,
  fn: (session: BrowserUseSession) => Promise<T>,
): Promise<T> {
  const session = await createSession(proxyCountry, timeoutMinutes);
  try {
    return await fn(session);
  } finally {
    try {
      await stopSession(session.id);
    } catch (e: unknown) {
      // Best-effort: session will auto-time-out anyway, don't mask
      // the original error.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`browseruse: stopSession(${session.id}) failed: ${msg}`);
    }
  }
}
