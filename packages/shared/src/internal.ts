import { timingSafeEqual } from 'crypto';

// Service-to-service endpoints (worker -> publishing-service publish, publishing/analytics -> account-service YouTube
// token refresh) sit on the same public domains as the browser-facing API, so they need their own credential: a
// shared secret in INTERNAL_API_KEY, sent in this header. Without it anyone who learned a job or account id could
// trigger a publish or mint a live YouTube access token.
export const INTERNAL_KEY_HEADER = 'x-internal-key';

/** Headers to add to a service-to-service call. Empty when no key is configured (local development). */
export function internalHeaders(): Record<string, string> {
  const key = process.env.INTERNAL_API_KEY;
  return key ? { [INTERNAL_KEY_HEADER]: key } : {};
}

let warnedMissingKey = false;

/**
 * True when the request carries the configured internal key. With no INTERNAL_API_KEY set, requests are allowed
 * outside production (so local dev keeps working) and refused in production (fail closed).
 */
export function isInternalRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('[internal] INTERNAL_API_KEY is not set; internal endpoints are ' +
        (process.env.NODE_ENV === 'production' ? 'refusing all calls.' : 'open (development only).'));
    }
    return process.env.NODE_ENV !== 'production';
  }
  const sent = req.headers[INTERNAL_KEY_HEADER];
  if (typeof sent !== 'string') return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
