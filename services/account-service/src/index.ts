import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { TwitterApi } from 'twitter-api-v2';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

import { getCachedTeamRole, setCachedTeamRole } from '@socialpush/shared';

const PINTEREST_API_BASE = process.env.PINTEREST_API_BASE || 'https://api.pinterest.com';

// Trial-access apps get 401 in the sandbox with a normal OAuth token; the sandbox needs the token generated in the Pinterest developer portal.
const pinterestToken = (oauthToken: string) =>
  PINTEREST_API_BASE.includes('sandbox') && process.env.PINTEREST_SANDBOX_TOKEN ? process.env.PINTEREST_SANDBOX_TOKEN : oauthToken;

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const oauthStates = new Map<string, { codeVerifier: string, state: string, userId: string, teamId: string }>();
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

function encrypt(text: string) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

app.get('/api/v1/auth/:platform/url', async (req, res) => {
  const { userId, teamId } = req.query; 
  const { platform } = req.params;
  if (!userId || !teamId) return res.status(401).json({ error: 'Unauthorized or missing teamId' });

  let role = await getCachedTeamRole(teamId as string, userId as string);
  let plan = 'free'; // default plan if not fetched from db

  if (!role) {
    const { data: member } = await supabase.from('team_members').select('role, teams(plan)').eq('team_id', teamId).eq('user_id', userId).single();
    if (member) {
      role = member.role;
      plan = (member.teams as any)?.plan || 'free';
      await setCachedTeamRole(teamId as string, userId as string, role as string);
    }
  }

  if (!role || role === 'viewer') return res.status(403).json({ error: 'Unauthorized: Viewers cannot connect accounts' });

  // For billing check, ideally plan should also be cached if we want to avoid DB entirely, 
  // but for now we'll fetch team plan only if necessary or keep it simple.
  // We'll just fetch plan here if we had a cache hit for role but need to check billing.
  // Actually, billing check requires `teams(plan)`. Let's fetch it if role is cached but plan isn't known.
  if (role && plan === 'free') {
    // just re-verify plan to be safe, or cache plan too. To keep changes minimal, we'll fetch team plan here
    const { data: teamData } = await supabase.from('teams').select('plan').eq('id', teamId).single();
    if (teamData) plan = teamData.plan;
  }

  if (plan === 'free') {
    const { count } = await supabase.from('social_accounts').select('*', { count: 'exact', head: true }).eq('team_id', teamId);
    if (count !== null && count >= 10) {
      return res.status(402).json({ error: 'Billing limit reached: Free plan allows max 10 accounts.' });
    }
  }

  if (platform === 'twitter') {
    const client = new TwitterApi({ clientId: process.env.TWITTER_CLIENT_ID || 'mock', clientSecret: process.env.TWITTER_CLIENT_SECRET || 'mock' });
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
      `${API_BASE_URL}/api/v1/auth/twitter/callback`,
      { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
    );
    oauthStates.set(state, { codeVerifier, state, userId: userId.toString(), teamId: teamId.toString() });
    res.json({ url });
  } else if (platform === 'facebook' || platform === 'instagram' || platform === 'threads') {
    const state = crypto.randomBytes(16).toString('hex');
    const appId = platform === 'threads' ? process.env.THREADS_CLIENT_ID : process.env.FACEBOOK_APP_ID;
    const redirectUri = encodeURIComponent(`${API_BASE_URL}/api/v1/auth/${platform}/callback`);
    
    let scopeStr = '';
    if (platform === 'threads') {
      scopeStr = encodeURIComponent('threads_basic,threads_content_publish');
    } else {
      scopeStr = encodeURIComponent('pages_show_list,instagram_basic,instagram_content_publish,pages_read_engagement,pages_manage_posts,publish_video');
    }
    
    let url = '';
    if (platform === 'threads') {
      url = `https://threads.net/oauth/authorize?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scopeStr}&response_type=code&state=${state}`;
    } else {
      url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&state=${state}&scope=${scopeStr}`;
    }
    
    oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
    res.json({ url });
  } else if (platform === 'youtube') {
    const state = crypto.randomBytes(16).toString('hex');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri!)}&response_type=code&scope=${scope}&state=${state}&access_type=offline&prompt=consent`;
    
    oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
    res.json({ url });
  } else if (platform === 'linkedin') {
    const state = crypto.randomBytes(16).toString('hex');
    const clientId = process.env.LINKEDIN_CLIENT_ID || 'mock';
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${API_BASE_URL}/api/v1/auth/linkedin/callback`;
    const scope = encodeURIComponent('openid profile email w_member_social');
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scope}`;
    
    oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
    res.json({ url });
  } else if (platform === 'pinterest') {
    const state = crypto.randomBytes(16).toString('hex');
    const clientId = process.env.PINTEREST_CLIENT_ID || 'mock';
    const redirectUri = process.env.PINTEREST_REDIRECT_URI || `${API_BASE_URL}/api/v1/auth/pinterest/callback`;
    const scope = encodeURIComponent('boards:read,boards:write,pins:read,pins:write,user_accounts:read');
    const url = `https://www.pinterest.com/oauth/?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;
    
    oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
    res.json({ url });
  } else if (platform === 'tiktok') {
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { codeVerifier: 'mock', state, userId: userId.toString(), teamId: teamId.toString() });
    res.json({ url: `${API_BASE_URL}/api/v1/auth/${platform}/callback?state=${state}&code=mock_code` });
  } else {
    res.status(400).json({ error: 'Unknown platform' });
  }
});

app.get('/api/v1/auth/:platform/callback', async (req, res) => {
  const { platform } = req.params;
  const { state, code } = req.query;
  const session = oauthStates.get(state as string);
  
  if (!session || !state || !code) return res.status(400).send('Invalid state or code');

  try {
    let encryptedAccess, encryptedRefresh;

    if (platform === 'twitter') {
      const client = new TwitterApi({ clientId: process.env.TWITTER_CLIENT_ID || 'mock', clientSecret: process.env.TWITTER_CLIENT_SECRET || 'mock' });
      const { client: loggedClient, accessToken, refreshToken } = await client.loginWithOAuth2({
        code: code as string,
        codeVerifier: session.codeVerifier,
        redirectUri: `${API_BASE_URL}/api/v1/auth/twitter/callback`,
      });
      encryptedAccess = encrypt(accessToken);
      encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
    } else if (platform === 'facebook' || platform === 'instagram' || platform === 'threads') {
      const appId = platform === 'threads' ? process.env.THREADS_CLIENT_ID : process.env.FACEBOOK_APP_ID;
      const appSecret = platform === 'threads' ? process.env.THREADS_CLIENT_SECRET : process.env.FACEBOOK_APP_SECRET;
      const redirectUri = `${API_BASE_URL}/api/v1/auth/${platform}/callback`;
      
      let finalToken = '';

      if (platform === 'threads') {
        const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: appId!,
            client_secret: appSecret!,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code: code as string
          }).toString()
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error_message || tokenData.error.message || 'Failed Threads short-lived token');

        const longLivedRes = await fetch(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${tokenData.access_token}`);
        const longLivedData = await longLivedRes.json();
        if (longLivedData.error) throw new Error(longLivedData.error_message || longLivedData.error.message || 'Failed Threads long-lived token');
        
        finalToken = longLivedData.access_token || tokenData.access_token;
      } else {
        const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
        const tokenData = await tokenRes.json();
        
        if (tokenData.error) throw new Error(tokenData.error.message);
        
        const longLivedRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
        const longLivedData = await longLivedRes.json();
        
        if (longLivedData.error) throw new Error(longLivedData.error.message);
        
        finalToken = longLivedData.access_token || tokenData.access_token;
      }
      
      encryptedAccess = encrypt(finalToken);
      encryptedRefresh = encrypt('none'); 
    } else if (platform === 'youtube') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;
      
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri!,
        })
      });
      const tokenData = await tokenRes.json();
      
      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
      
      encryptedAccess = encrypt(tokenData.access_token);
      encryptedRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : encrypt('none');
    } else if (platform === 'pinterest') {
      const clientId = process.env.PINTEREST_CLIENT_ID;
      const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
      const redirectUri = process.env.PINTEREST_REDIRECT_URI || `${API_BASE_URL}/api/v1/auth/pinterest/callback`;
      
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      
      const tokenRes = await fetch(`https://api.pinterest.com/v5/oauth/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri
        }).toString()
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.message || 'Failed to get Pinterest token');
      
      const encAccess = encrypt(tokenData.access_token);
      const encRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;
      
      const userRes = await fetch(`https://api.pinterest.com/v5/user_account`, {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      const userData = await userRes.json();
      if (!userRes.ok) throw new Error(userData.message || 'Failed to fetch Pinterest profile');
      
      const { data: saData, error: saError } = await supabase.from('social_accounts').insert({
        user_id: session.userId,
        team_id: session.teamId,
        platform: 'pinterest',
        provider_account_id: userData.username || userData.id || 'unknown',
        handle: userData.username || 'unknown',
        access_token_encrypted: encAccess,
        refresh_token_encrypted: encRefresh,
        refresh_token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'active'
      }).select().single();

      if (saError) throw saError;

      const boardToken = pinterestToken(tokenData.access_token);
      const boardsRes = await fetch(`${PINTEREST_API_BASE}/v5/boards`, {
        headers: { 'Authorization': `Bearer ${boardToken}` }
      });
      const boardsData = await boardsRes.json();
      if (!boardsRes.ok) console.error('Pinterest board import failed:', boardsRes.status, boardsData.message);
      let boards = boardsData.items || [];
      
      if (boards.length === 0) {
        const createBoardRes = await fetch(`${PINTEREST_API_BASE}/v5/boards`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${boardToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: 'SocialPush' })
        });
        const newBoard = await createBoardRes.json();
        if (createBoardRes.ok) boards = [newBoard];
        else console.error('Pinterest default board create failed:', createBoardRes.status, newBoard.message);
      }

      for (const [index, board] of boards.entries()) {
        await supabase.from('pinterest_boards').insert({
          social_account_id: saData.id,
          user_id: session.userId,
          pinterest_board_id: board.id,
          board_name: board.name,
          is_default: index === 0
        }); 
      }
      
      oauthStates.delete(state as string);
      return res.send('<script>window.close();</script>Account connected successfully!');
    } else if (platform === 'linkedin') {
      const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${API_BASE_URL}/api/v1/auth/linkedin/callback`;

      const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
          redirect_uri: redirectUri,
        }).toString()
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'Failed to get LinkedIn token');
      }

      const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      const userData = await userRes.json();
      if (!userRes.ok || !userData.sub) throw new Error('Failed to fetch LinkedIn profile');

      const fields = {
        user_id: session.userId,
        team_id: session.teamId,
        platform: 'linkedin',
        provider_account_id: userData.sub,
        handle: userData.name || userData.email || userData.sub,
        target_type: 'member',
        access_token_encrypted: encrypt(tokenData.access_token),
        refresh_token_encrypted: tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
        // LinkedIn access tokens last ~60 days; no refresh token is issued to standard apps.
        refresh_token_expires_at: new Date(Date.now() + (tokenData.expires_in || 60 * 24 * 60 * 60) * 1000).toISOString(),
      };

      // Reconnecting the same LinkedIn member replaces the token instead of adding a duplicate row.
      const { data: existing } = await supabase.from('social_accounts').select('id')
        .eq('team_id', session.teamId).eq('platform', 'linkedin').eq('provider_account_id', userData.sub).maybeSingle();
      const { error: saError } = existing
        ? await supabase.from('social_accounts').update(fields).eq('id', existing.id)
        : await supabase.from('social_accounts').insert(fields);
      if (saError) throw saError;

      oauthStates.delete(state as string);
      return res.send('<script>window.close();</script>Account connected successfully!');
    } else {
      // Mock tokens for TikTok etc
      encryptedAccess = encrypt(`mock_${platform}_access_token`);
      encryptedRefresh = encrypt(`mock_${platform}_refresh_token`);
    }

    await supabase.from('social_accounts').insert({
      user_id: session.userId,
      team_id: session.teamId,
      platform,
      access_token_encrypted: encryptedAccess,
      refresh_token_encrypted: encryptedRefresh,
    });

    oauthStates.delete(state as string);
    res.send('<script>window.close();</script>Account connected successfully!');
  } catch (error) {
    console.error(error);
    res.status(500).send('Authentication failed');
  }
});

app.delete('/api/v1/auth/accounts/:id', async (req, res) => {
  const { id } = req.params;
  const { teamId, userId } = req.query;
  
  if (!teamId || !userId) return res.status(401).json({ error: 'Missing credentials' });

  // Verify role
  let role = await getCachedTeamRole(teamId as string, userId as string);
  if (!role) {
    const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
    if (member) {
      role = member.role;
      await setCachedTeamRole(teamId as string, userId as string, role as string);
    }
  }
  
  if (!role || role === 'viewer') return res.status(403).json({ error: 'Unauthorized' });

  // Delete account
  const { error } = await supabase.from('social_accounts').delete().eq('id', id).eq('team_id', teamId);
  if (error) return res.status(500).json({ error: error.message });
  
  res.json({ success: true });
});

export async function refreshYouTubeToken(accountId: string, refreshTokenEncrypted: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  // Decrypt refresh token
  const [ivHex, encryptedHex] = refreshTokenEncrypted.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), Buffer.from(ivHex, 'hex'));
  let refreshToken = decipher.update(encryptedHex, 'hex', 'utf8');
  refreshToken += decipher.final('utf8');

  if (refreshToken === 'none') throw new Error('No refresh token available');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

  const encryptedAccess = encrypt(tokenData.access_token);
  // Google might return a new refresh token, or might not.
  const encryptedRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : refreshTokenEncrypted;

  await supabase.from('social_accounts').update({
    access_token_encrypted: encryptedAccess,
    refresh_token_encrypted: encryptedRefresh,
    updated_at: new Date().toISOString()
  }).eq('id', accountId);

  return tokenData.access_token;
}

app.post('/api/v1/auth/youtube/refresh', async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: 'Missing accountId' });

  const { data: account } = await supabase.from('social_accounts').select('refresh_token_encrypted, platform').eq('id', accountId).single();
  if (!account || account.platform !== 'youtube' || !account.refresh_token_encrypted) {
    return res.status(404).json({ error: 'Valid YouTube account not found' });
  }

  try {
    const newAccessToken = await refreshYouTubeToken(accountId, account.refresh_token_encrypted);
    res.json({ success: true, accessToken: newAccessToken });
  } catch (error: any) {
    console.error('Failed to refresh YouTube token:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Account Service listening on port ${PORT}`));
