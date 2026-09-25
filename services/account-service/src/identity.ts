// Looks up "which account is this?" (display name / @username) for a freshly issued access token, so the
// Accounts page can show it. Purely cosmetic: it never throws, and returns null when the lookup fails so a
// hiccup here can never break connecting an account.
//
// It mirrors which Page / account the publishing adapters actually post to:
//  - Facebook: the first Page in /me/accounts (publishing uses pages[0])
//  - Instagram: the first Page that has an Instagram business account (publishing uses that one)

export type AccountIdentity = {
  handle: string;
  providerAccountId?: string;
  channelTitle?: string;
  channelId?: string;
};

const GRAPH = 'https://graph.facebook.com/v18.0';

async function getJson(url: string, headers?: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers });
  const body = await res.json();
  if (!res.ok || body?.error) throw new Error(body?.error?.message || body?.error_message || `HTTP ${res.status}`);
  return body;
}

// Same page lookup the publishing adapter uses. /me/accounts comes back empty for accounts whose Pages sit in
// a Business portfolio, but the token still carries the Page ids in debug_token's granular_scopes.
async function getFacebookPages(accessToken: string): Promise<any[]> {
  const fields = 'id,name,instagram_business_account{id,username}';
  const direct = (await getJson(`${GRAPH}/me/accounts?fields=${fields}&access_token=${accessToken}`)).data || [];
  if (direct.length > 0) return direct;

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return [];
  const debug = await getJson(`${GRAPH}/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`);
  const targetIds = new Set<string>();
  for (const scope of debug.data?.granular_scopes || []) (scope.target_ids || []).forEach((id: string) => targetIds.add(id));

  const pages: any[] = [];
  for (const id of targetIds) {
    try {
      const page = await getJson(`${GRAPH}/${id}?fields=${fields},access_token&access_token=${accessToken}`);
      if (page.access_token) pages.push(page); // ids that are not Pages (e.g. the Instagram account id) have no page token
    } catch { /* not a Page we can read */ }
  }
  return pages;
}

export async function fetchAccountIdentity(platform: string, accessToken: string): Promise<AccountIdentity | null> {
  try {
    if (platform === 'facebook') {
      const page = (await getFacebookPages(accessToken))[0]; // publishing posts to the first Page
      if (page) return { handle: page.name, providerAccountId: page.id };
      const me = await getJson(`${GRAPH}/me?fields=id,name&access_token=${accessToken}`);
      return me.name ? { handle: me.name, providerAccountId: me.id } : null;
    }

    if (platform === 'instagram') {
      const ig = (await getFacebookPages(accessToken)).find((p: any) => p.instagram_business_account)?.instagram_business_account;
      return ig?.username ? { handle: ig.username, providerAccountId: ig.id } : null;
    }

    if (platform === 'threads') {
      const me = await getJson(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken}`);
      return me.username ? { handle: me.username, providerAccountId: me.id } : null;
    }

    if (platform === 'youtube') {
      const ch = (await getJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { Authorization: `Bearer ${accessToken}` })).items?.[0];
      if (!ch?.snippet?.title) return null;
      return { handle: ch.snippet.title, providerAccountId: ch.id, channelTitle: ch.snippet.title, channelId: ch.id };
    }
  } catch (err) {
    console.warn(`Could not look up the ${platform} account name:`, err instanceof Error ? err.message : err);
  }
  return null;
}
