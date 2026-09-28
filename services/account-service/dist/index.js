"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshYouTubeToken = refreshYouTubeToken;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const twitter_api_v2_1 = require("twitter-api-v2");
const crypto_1 = __importDefault(require("crypto"));
const supabase_js_1 = require("@supabase/supabase-js");
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const shared_1 = require("@socialpush/shared");
const identity_1 = require("./identity");
const PINTEREST_API_BASE = process.env.PINTEREST_API_BASE || 'https://api.pinterest.com';
// Trial-access apps get 401 in the sandbox with a normal OAuth token; the sandbox needs the token generated in the Pinterest developer portal.
const pinterestToken = (oauthToken) => PINTEREST_API_BASE.includes('sandbox') && process.env.PINTEREST_SANDBOX_TOKEN ? process.env.PINTEREST_SANDBOX_TOKEN : oauthToken;
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey);
const oauthStates = new Map();
const ENCRYPTION_KEY = (0, shared_1.requireEncryptionKey)();
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
// Reconnecting an already-connected account must replace its row, not add a second one (downstream code that
// does `.eq('platform', ...).single()` would then crash on "multiple rows returned"). Matches on provider_account_id
// when known (the platform-side page/channel/member id, captured via fetchAccountIdentity); falls back to just
// team+platform when it isn't (a failed identity lookup, or a platform - like Pinterest below - that always
// updates its own team+platform row). Mirrors the pattern LinkedIn's callback already used successfully.
async function upsertSocialAccount(fields) {
    let query = supabase.from('social_accounts').select('id').eq('team_id', fields.team_id).eq('platform', fields.platform);
    if (fields.provider_account_id)
        query = query.eq('provider_account_id', fields.provider_account_id);
    const { data: existing } = await query.maybeSingle();
    return existing
        ? supabase.from('social_accounts').update(fields).eq('id', existing.id).select().single()
        : supabase.from('social_accounts').insert(fields).select().single();
}
function encrypt(text) {
    const iv = crypto_1.default.randomBytes(16);
    const cipher = crypto_1.default.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}
app.get('/api/v1/auth/:platform/url', async (req, res) => {
    const { teamId } = req.query;
    const { platform } = req.params;
    if (!teamId)
        return res.status(400).json({ error: 'Missing teamId' });
    // The caller's identity comes from their verified Supabase session, never from the query string - otherwise
    // anyone who learns a victim's userId+teamId could mint a real OAuth URL and link their own social account to
    // the victim's team once they complete the consent screen.
    const authed = await (0, shared_1.requireUser)(req, supabase);
    if ('error' in authed)
        return res.status(authed.status).json({ error: authed.error });
    const userId = authed.userId;
    let role = await (0, shared_1.getCachedTeamRole)(teamId, userId);
    let plan = 'free'; // default plan if not fetched from db
    if (!role) {
        const { data: member } = await supabase.from('team_members').select('role, teams(plan)').eq('team_id', teamId).eq('user_id', userId).single();
        if (member) {
            role = member.role;
            plan = member.teams?.plan || 'free';
            await (0, shared_1.setCachedTeamRole)(teamId, userId, role);
        }
    }
    if (!role || role === 'viewer')
        return res.status(403).json({ error: 'Unauthorized: Viewers cannot connect accounts' });
    // For billing check, ideally plan should also be cached if we want to avoid DB entirely, 
    // but for now we'll fetch team plan only if necessary or keep it simple.
    // We'll just fetch plan here if we had a cache hit for role but need to check billing.
    // Actually, billing check requires `teams(plan)`. Let's fetch it if role is cached but plan isn't known.
    if (role && plan === 'free') {
        // just re-verify plan to be safe, or cache plan too. To keep changes minimal, we'll fetch team plan here
        const { data: teamData } = await supabase.from('teams').select('plan').eq('id', teamId).single();
        if (teamData)
            plan = teamData.plan;
    }
    if (plan === 'free') {
        const { count } = await supabase.from('social_accounts').select('*', { count: 'exact', head: true }).eq('team_id', teamId);
        if (count !== null && count >= 10) {
            return res.status(402).json({ error: 'Billing limit reached: Free plan allows max 10 accounts.' });
        }
    }
    if (platform === 'twitter') {
        const client = new twitter_api_v2_1.TwitterApi({ clientId: process.env.TWITTER_CLIENT_ID || 'mock', clientSecret: process.env.TWITTER_CLIENT_SECRET || 'mock' });
        const { url, codeVerifier, state } = client.generateOAuth2AuthLink(`${API_BASE_URL}/api/v1/auth/twitter/callback`, { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] });
        oauthStates.set(state, { codeVerifier, state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url });
    }
    else if (platform === 'facebook' || platform === 'instagram' || platform === 'threads') {
        const state = crypto_1.default.randomBytes(16).toString('hex');
        const appId = platform === 'threads' ? process.env.THREADS_CLIENT_ID : process.env.FACEBOOK_APP_ID;
        const redirectUri = encodeURIComponent(`${API_BASE_URL}/api/v1/auth/${platform}/callback`);
        // Comment permissions are only requested when ENABLE_COMMENT_SCOPES=true: Meta rejects a login that asks for a
        // permission the app has not been given yet (add them under the app's use cases first).
        const commentScopes = process.env.ENABLE_COMMENT_SCOPES === 'true';
        let scopeStr = '';
        if (platform === 'threads') {
            scopeStr = encodeURIComponent('threads_basic,threads_content_publish,threads_manage_insights' + (commentScopes ? ',threads_read_replies,threads_manage_replies' : ''));
        }
        else {
            scopeStr = encodeURIComponent('pages_show_list,instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,pages_manage_posts,publish_video' + (commentScopes ? ',pages_read_user_content,pages_manage_engagement,instagram_manage_comments' : ''));
        }
        let url = '';
        if (platform === 'threads') {
            url = `https://threads.net/oauth/authorize?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scopeStr}&response_type=code&state=${state}`;
        }
        else {
            url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&state=${state}&scope=${scopeStr}`;
        }
        oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url });
    }
    else if (platform === 'youtube') {
        const state = crypto_1.default.randomBytes(16).toString('hex');
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;
        const scope = encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' + (process.env.ENABLE_COMMENT_SCOPES === 'true' ? ' https://www.googleapis.com/auth/youtube.force-ssl' : ''));
        const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&access_type=offline&prompt=consent`;
        oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url });
    }
    else if (platform === 'linkedin') {
        const state = crypto_1.default.randomBytes(16).toString('hex');
        const clientId = process.env.LINKEDIN_CLIENT_ID || 'mock';
        const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${API_BASE_URL}/api/v1/auth/linkedin/callback`;
        const scope = encodeURIComponent('openid profile email w_member_social');
        const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scope}`;
        oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url });
    }
    else if (platform === 'pinterest') {
        const state = crypto_1.default.randomBytes(16).toString('hex');
        const clientId = process.env.PINTEREST_CLIENT_ID || 'mock';
        const redirectUri = process.env.PINTEREST_REDIRECT_URI || `${API_BASE_URL}/api/v1/auth/pinterest/callback`;
        const scope = encodeURIComponent('boards:read,boards:write,pins:read,pins:write,user_accounts:read');
        const url = `https://www.pinterest.com/oauth/?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;
        oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url });
    }
    else if (platform === 'tiktok') {
        const state = crypto_1.default.randomBytes(16).toString('hex');
        oauthStates.set(state, { codeVerifier: 'mock', state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url: `${API_BASE_URL}/api/v1/auth/${platform}/callback?state=${state}&code=mock_code` });
    }
    else {
        res.status(400).json({ error: 'Unknown platform' });
    }
});
app.get('/api/v1/auth/:platform/callback', async (req, res) => {
    const { platform } = req.params;
    const { state, code } = req.query;
    const session = oauthStates.get(state);
    if (!session || !state || !code)
        return res.status(400).send('Invalid state or code');
    try {
        let encryptedAccess, encryptedRefresh;
        // Plain access token, kept only to look up the account's display name below (never stored as-is).
        let plainAccessToken = '';
        if (platform === 'twitter') {
            const client = new twitter_api_v2_1.TwitterApi({ clientId: process.env.TWITTER_CLIENT_ID || 'mock', clientSecret: process.env.TWITTER_CLIENT_SECRET || 'mock' });
            const { client: loggedClient, accessToken, refreshToken } = await client.loginWithOAuth2({
                code: code,
                codeVerifier: session.codeVerifier,
                redirectUri: `${API_BASE_URL}/api/v1/auth/twitter/callback`,
            });
            encryptedAccess = encrypt(accessToken);
            encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
        }
        else if (platform === 'facebook' || platform === 'instagram' || platform === 'threads') {
            const appId = platform === 'threads' ? process.env.THREADS_CLIENT_ID : process.env.FACEBOOK_APP_ID;
            const appSecret = platform === 'threads' ? process.env.THREADS_CLIENT_SECRET : process.env.FACEBOOK_APP_SECRET;
            const redirectUri = `${API_BASE_URL}/api/v1/auth/${platform}/callback`;
            let finalToken = '';
            if (platform === 'threads') {
                const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: appId,
                        client_secret: appSecret,
                        grant_type: 'authorization_code',
                        redirect_uri: redirectUri,
                        code: code
                    }).toString()
                });
                const tokenData = await tokenRes.json();
                if (tokenData.error)
                    throw new Error(tokenData.error_message || tokenData.error.message || 'Failed Threads short-lived token');
                const longLivedRes = await fetch(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${tokenData.access_token}`);
                const longLivedData = await longLivedRes.json();
                if (longLivedData.error)
                    throw new Error(longLivedData.error_message || longLivedData.error.message || 'Failed Threads long-lived token');
                finalToken = longLivedData.access_token || tokenData.access_token;
            }
            else {
                const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
                const tokenData = await tokenRes.json();
                if (tokenData.error)
                    throw new Error(tokenData.error.message);
                const longLivedRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
                const longLivedData = await longLivedRes.json();
                if (longLivedData.error)
                    throw new Error(longLivedData.error.message);
                finalToken = longLivedData.access_token || tokenData.access_token;
            }
            plainAccessToken = finalToken;
            encryptedAccess = encrypt(finalToken);
            encryptedRefresh = encrypt('none');
        }
        else if (platform === 'youtube') {
            const clientId = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            const redirectUri = process.env.GOOGLE_REDIRECT_URI;
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: code,
                    grant_type: 'authorization_code',
                    redirect_uri: redirectUri,
                })
            });
            const tokenData = await tokenRes.json();
            if (tokenData.error)
                throw new Error(tokenData.error_description || tokenData.error);
            plainAccessToken = tokenData.access_token;
            encryptedAccess = encrypt(tokenData.access_token);
            encryptedRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : encrypt('none');
        }
        else if (platform === 'pinterest') {
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
                    code: code,
                    redirect_uri: redirectUri
                }).toString()
            });
            const tokenData = await tokenRes.json();
            if (!tokenRes.ok)
                throw new Error(tokenData.message || 'Failed to get Pinterest token');
            const encAccess = encrypt(tokenData.access_token);
            const encRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;
            const userRes = await fetch(`https://api.pinterest.com/v5/user_account`, {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            });
            const userData = await userRes.json();
            if (!userRes.ok)
                throw new Error(userData.message || 'Failed to fetch Pinterest profile');
            const { data: saData, error: saError } = await upsertSocialAccount({
                user_id: session.userId,
                team_id: session.teamId,
                platform: 'pinterest',
                provider_account_id: userData.username || userData.id || 'unknown',
                handle: userData.username || 'unknown',
                access_token_encrypted: encAccess,
                refresh_token_encrypted: encRefresh,
                refresh_token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
                status: 'active'
            });
            if (saError)
                throw saError;
            const boardToken = pinterestToken(tokenData.access_token);
            const boardsRes = await fetch(`${PINTEREST_API_BASE}/v5/boards`, {
                headers: { 'Authorization': `Bearer ${boardToken}` }
            });
            const boardsData = await boardsRes.json();
            if (!boardsRes.ok)
                console.error('Pinterest board import failed:', boardsRes.status, boardsData.message);
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
                if (createBoardRes.ok)
                    boards = [newBoard];
                else
                    console.error('Pinterest default board create failed:', createBoardRes.status, newBoard.message);
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
            oauthStates.delete(state);
            return res.send('<script>window.close();</script>Account connected successfully!');
        }
        else if (platform === 'linkedin') {
            const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${API_BASE_URL}/api/v1/auth/linkedin/callback`;
            const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    client_id: process.env.LINKEDIN_CLIENT_ID,
                    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
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
            if (!userRes.ok || !userData.sub)
                throw new Error('Failed to fetch LinkedIn profile');
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
            if (saError)
                throw saError;
            oauthStates.delete(state);
            return res.send('<script>window.close();</script>Account connected successfully!');
        }
        else {
            // Mock tokens for TikTok etc
            encryptedAccess = encrypt(`mock_${platform}_access_token`);
            encryptedRefresh = encrypt(`mock_${platform}_refresh_token`);
        }
        // Save which account this is (Page name, @username, channel) so the Accounts page can show it.
        // Cosmetic only: a failed lookup just leaves these empty.
        const identity = plainAccessToken ? await (0, identity_1.fetchAccountIdentity)(platform, plainAccessToken) : null;
        await upsertSocialAccount({
            user_id: session.userId,
            team_id: session.teamId,
            platform,
            access_token_encrypted: encryptedAccess,
            refresh_token_encrypted: encryptedRefresh,
            ...(identity && {
                handle: identity.handle,
                ...(identity.providerAccountId && { provider_account_id: identity.providerAccountId }),
                ...(identity.channelTitle && { channel_title: identity.channelTitle }),
                ...(identity.channelId && { channel_id: identity.channelId }),
            }),
        });
        oauthStates.delete(state);
        res.send('<script>window.close();</script>Account connected successfully!');
    }
    catch (error) {
        console.error(error);
        res.status(500).send('Authentication failed');
    }
});
app.delete('/api/v1/auth/accounts/:id', async (req, res) => {
    const { id } = req.params;
    const { teamId } = req.query;
    if (!teamId)
        return res.status(400).json({ error: 'Missing teamId' });
    const authed = await (0, shared_1.requireUser)(req, supabase);
    if ('error' in authed)
        return res.status(authed.status).json({ error: authed.error });
    const userId = authed.userId;
    // Verify role
    let role = await (0, shared_1.getCachedTeamRole)(teamId, userId);
    if (!role) {
        const { data: member } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
        if (member) {
            role = member.role;
            await (0, shared_1.setCachedTeamRole)(teamId, userId, role);
        }
    }
    if (!role || role === 'viewer')
        return res.status(403).json({ error: 'Unauthorized' });
    // Delete account
    const { error } = await supabase.from('social_accounts').delete().eq('id', id).eq('team_id', teamId);
    if (error)
        return res.status(500).json({ error: error.message });
    res.json({ success: true });
});
async function refreshYouTubeToken(accountId, refreshTokenEncrypted) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    // Decrypt refresh token
    const [ivHex, encryptedHex] = refreshTokenEncrypted.split(':');
    const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), Buffer.from(ivHex, 'hex'));
    let refreshToken = decipher.update(encryptedHex, 'hex', 'utf8');
    refreshToken += decipher.final('utf8');
    if (refreshToken === 'none')
        throw new Error('No refresh token available');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error)
        throw new Error(tokenData.error_description || tokenData.error);
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
    if (!accountId)
        return res.status(400).json({ error: 'Missing accountId' });
    const { data: account } = await supabase.from('social_accounts').select('refresh_token_encrypted, platform').eq('id', accountId).single();
    if (!account || account.platform !== 'youtube' || !account.refresh_token_encrypted) {
        return res.status(404).json({ error: 'Valid YouTube account not found' });
    }
    try {
        const newAccessToken = await refreshYouTubeToken(accountId, account.refresh_token_encrypted);
        res.json({ success: true, accessToken: newAccessToken });
    }
    catch (error) {
        console.error('Failed to refresh YouTube token:', error);
        res.status(500).json({ error: error.message });
    }
});
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Account Service listening on port ${PORT}`));
