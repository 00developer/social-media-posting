// Some ISPs (notably several in India) block *.supabase.co. When the app is configured with a proxied / custom
// Supabase URL (NEXT_PUBLIC_SUPABASE_URL that is not itself on supabase.co), media saved by older posts as
// https://<ref>.supabase.co/storage/... is rewritten at render time to go through that URL instead.
// Only what is displayed changes - stored values and anything sent to the backend stay untouched.

const SUPABASE_STORAGE_RE = /^https?:\/\/[^/?#]+\.supabase\.co\/storage\//i;

function isSupabaseCoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'supabase.co' || host.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

/**
 * Rewrites a *.supabase.co storage URL to `${base}/storage/...`, where base is the configured Supabase URL.
 * Returns the input unchanged when there is no usable base, the base is itself on supabase.co, or the URL is not
 * a Supabase storage URL. `base` defaults to NEXT_PUBLIC_SUPABASE_URL (passed explicitly in tests).
 */
export function resolveMediaUrl<T extends string | null | undefined>(url: T, base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): T {
  if (!url || !base) return url;
  const trimmedBase = base.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmedBase) || isSupabaseCoUrl(trimmedBase)) return url;
  if (!SUPABASE_STORAGE_RE.test(url)) return url;
  return url.replace(SUPABASE_STORAGE_RE, `${trimmedBase}/storage/`) as T;
}
