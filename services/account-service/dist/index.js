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
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey);
const oauthStates = new Map();
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';
function encrypt(text) {
    const iv = crypto_1.default.randomBytes(16);
    const cipher = crypto_1.default.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}
app.get('/api/v1/auth/:platform/url', async (req, res) => {
    const { userId, teamId } = req.query;
    const { platform } = req.params;
    if (!userId || !teamId)
        return res.status(401).json({ error: 'Unauthorized or missing teamId' });
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
        if (count !== null && count >= 3) {
            return res.status(402).json({ error: 'Billing limit reached: Free plan allows max 3 accounts.' });
        }
    }
    if (platform === 'twitter') {
        const client = new twitter_api_v2_1.TwitterApi({ clientId: process.env.TWITTER_CLIENT_ID || 'mock', clientSecret: process.env.TWITTER_CLIENT_SECRET || 'mock' });
        const { url, codeVerifier, state } = client.generateOAuth2AuthLink('http://localhost:3001/api/v1/auth/twitter/callback', { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] });
        oauthStates.set(state, { codeVerifier, state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url });
    }
    else if (platform === 'facebook' || platform === 'instagram') {
        const state = crypto_1.default.randomBytes(16).toString('hex');
        const appId = process.env.FACEBOOK_APP_ID;
        const redirectUri = encodeURIComponent(`http://localhost:3001/api/v1/auth/${platform}/callback`);
        const scope = encodeURIComponent('pages_show_list,instagram_basic,instagram_content_publish,pages_read_engagement,pages_manage_posts,publish_video');
        const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}`;
        oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url });
    }
    else if (platform === 'youtube') {
        const state = crypto_1.default.randomBytes(16).toString('hex');
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;
        const scope = encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
        const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&access_type=offline&prompt=consent`;
        oauthStates.set(state, { codeVerifier: 'none', state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url });
    }
    else if (['linkedin', 'tiktok', 'pinterest'].includes(platform)) {
        const state = crypto_1.default.randomBytes(16).toString('hex');
        oauthStates.set(state, { codeVerifier: 'mock', state, userId: userId.toString(), teamId: teamId.toString() });
        res.json({ url: `http://localhost:3001/api/v1/auth/${platform}/callback?state=${state}&code=mock_code` });
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
        if (platform === 'twitter') {
            const client = new twitter_api_v2_1.TwitterApi({ clientId: process.env.TWITTER_CLIENT_ID || 'mock', clientSecret: process.env.TWITTER_CLIENT_SECRET || 'mock' });
            const { client: loggedClient, accessToken, refreshToken } = await client.loginWithOAuth2({
                code: code,
                codeVerifier: session.codeVerifier,
                redirectUri: 'http://localhost:3001/api/v1/auth/twitter/callback',
            });
            encryptedAccess = encrypt(accessToken);
            encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
        }
        else if (platform === 'facebook' || platform === 'instagram') {
            const appId = process.env.FACEBOOK_APP_ID;
            const appSecret = process.env.FACEBOOK_APP_SECRET;
            const redirectUri = `http://localhost:3001/api/v1/auth/${platform}/callback`;
            const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
            const tokenData = await tokenRes.json();
            if (tokenData.error)
                throw new Error(tokenData.error.message);
            const longLivedRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
            const longLivedData = await longLivedRes.json();
            if (longLivedData.error)
                throw new Error(longLivedData.error.message);
            const finalToken = longLivedData.access_token || tokenData.access_token;
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
            encryptedAccess = encrypt(tokenData.access_token);
            encryptedRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : encrypt('none');
        }
        else {
            // Mock tokens for LinkedIn etc
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
    const { teamId, userId } = req.query;
    if (!teamId || !userId)
        return res.status(401).json({ error: 'Missing credentials' });
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
