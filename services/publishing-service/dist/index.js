"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const twitter_api_v2_1 = require("twitter-api-v2");
const supabase_js_1 = require("@supabase/supabase-js");
const shared_1 = require("@socialpush/shared");
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
process.on('uncaughtException', (err) => {
    if (err?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT')
        return;
    console.error('[PublishingService] Uncaught Exception:', err.message || err);
});
process.on('unhandledRejection', (err) => {
    if (err?.code === 'ECONNRESET' || err?.cause?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND' || err?.cause?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT')
        return;
    console.error('[PublishingService] Unhandled Rejection:', err.message || err);
});
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ENCRYPTION_KEY = (0, shared_1.requireEncryptionKey)();
// Server-to-server call, not exposed to the browser - a plain env var (not NEXT_PUBLIC_*) is enough.
const ACCOUNT_SERVICE_URL = process.env.ACCOUNT_SERVICE_URL || 'http://localhost:3001';
function decrypt(text) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}
const mediaCache = new Map();
async function getMediaBuffer(url, retries = 3) {
    const cached = mediaCache.get(url);
    if (cached && Date.now() < cached.expiresAt) {
        console.log(`[MediaCache] Reusing cached media buffer for ${url.substring(0, 60)}... (${(cached.buffer.byteLength / (1024 * 1024)).toFixed(1)} MB)`);
        return { buffer: cached.buffer, mime: cached.mime };
    }
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[MediaCache] Downloading media from storage (attempt ${attempt}/${retries}): ${url.substring(0, 60)}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2 minute timeout per attempt
            const res = await fetch(url, { signal: controller.signal, headers: { 'Connection': 'close' } });
            clearTimeout(timeoutId);
            if (!res.ok) {
                throw new Error(`Storage returned HTTP ${res.status}: ${res.statusText}`);
            }
            const arrayBuf = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            const mime = res.headers.get('content-type') || 'application/octet-stream';
            console.log(`[MediaCache] Successfully downloaded ${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB in attempt ${attempt}`);
            // Cache for 10 minutes so all platforms for this post reuse the single download
            mediaCache.set(url, { buffer, mime, expiresAt: Date.now() + 10 * 60 * 1000 });
            for (const [k, v] of mediaCache.entries()) {
                if (Date.now() > v.expiresAt)
                    mediaCache.delete(k);
            }
            return { buffer, mime };
        }
        catch (err) {
            lastError = err;
            console.warn(`[MediaCache] Download attempt ${attempt} failed:`, err?.message || err);
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 2000 * attempt));
            }
        }
    }
    throw new Error(`Failed to download media after ${retries} attempts: ${lastError?.message || lastError}`);
}
class TwitterAdapter {
    async publish(post, account, decryptedToken, contentType, job) {
        const client = new twitter_api_v2_1.TwitterApi(decryptedToken);
        let mediaId = null;
        try {
            const media = JSON.parse(post.media_url || '{}');
            const mediaUrl = media.twitter || null;
            if (mediaUrl) {
                const { buffer, mime } = await getMediaBuffer(mediaUrl);
                const isVideo = mime.startsWith('video/');
                mediaId = await client.v2.uploadMedia(buffer, {
                    media_type: isVideo ? 'video/mp4' : (mime.includes('png') ? 'image/png' : 'image/jpeg'),
                    media_category: isVideo ? 'tweet_video' : 'tweet_image',
                });
            }
        }
        catch (e) {
            // Attaching media should never block the tweet itself - post text-only rather than fail the whole job.
            console.warn(`[TwitterAdapter] Could not attach media for post ${post.id}, tweeting text only: ${e.message}`);
            mediaId = null;
        }
        const tweet = await client.v2.tweet(post.content, mediaId ? { media: { media_ids: [mediaId] } } : undefined);
        await recordPublishedPost(post, 'twitter', tweet.data?.id, 'post');
        console.log(`[TwitterAdapter] Published post ${post.id}`);
    }
}
// Remember the platform-side id of what we published so the analytics service can look up its stats later.
// Best-effort: analytics must never make a successful publish fail (and the table may not exist yet).
async function recordPublishedPost(post, platform, externalId, kind = 'post') {
    if (!externalId)
        return;
    try {
        const { error } = await supabase.from('published_posts').upsert({ post_id: post.id, platform, external_id: String(externalId), external_kind: kind, user_id: post.user_id, team_id: post.team_id ?? null }, { onConflict: 'post_id,platform' });
        if (error)
            console.warn(`[published_posts] could not record the ${platform} id for post ${post.id}: ${error.message}`);
    }
    catch (e) {
        console.warn(`[published_posts] could not record the ${platform} id for post ${post.id}:`, e instanceof Error ? e.message : e);
    }
}
async function getFacebookPages(decryptedToken) {
    let pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${decryptedToken}`);
    let pagesData = await pagesRes.json();
    if (pagesData.data && pagesData.data.length > 0) {
        return pagesData.data;
    }
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret)
        return [];
    const debugRes = await fetch(`https://graph.facebook.com/v18.0/debug_token?input_token=${decryptedToken}&access_token=${appId}|${appSecret}`);
    const debugData = await debugRes.json();
    const targetIds = new Set();
    if (debugData.data?.granular_scopes) {
        for (const scope of debugData.data.granular_scopes) {
            if (scope.target_ids) {
                scope.target_ids.forEach((id) => targetIds.add(id));
            }
        }
    }
    const pages = [];
    for (const pageId of targetIds) {
        try {
            const pRes = await fetch(`https://graph.facebook.com/v18.0/${pageId}?fields=id,name,access_token,instagram_business_account&access_token=${decryptedToken}`);
            const pData = await pRes.json();
            if (pData.access_token)
                pages.push(pData);
        }
        catch (e) { }
    }
    return pages;
}
class FacebookAdapter {
    async publish(post, account, decryptedToken, contentType, job) {
        console.log(`[FacebookAdapter] Publishing post ${post.id}`);
        const pages = await getFacebookPages(decryptedToken);
        if (!pages || pages.length === 0)
            throw new Error("No Facebook pages found for this user.");
        // Facebook's /me/accounts does not guarantee stable ordering between calls, so blindly using pages[0] could
        // silently post to a different Page than the one shown when the user connected. Prefer the exact Page id
        // captured at connect time (account.provider_account_id, see account-service/src/identity.ts); only fall back
        // to the first page for accounts connected before that was recorded.
        const page = (account.provider_account_id && pages.find((p) => p.id === account.provider_account_id)) || pages[0];
        const pageToken = page.access_token;
        const pageId = page.id;
        let mediaUrl = null;
        try {
            const media = JSON.parse(post.media_url || '{}');
            mediaUrl = media.facebook || null;
        }
        catch (e) { }
        const isVideo = contentType === 'reel' || !!(mediaUrl && (/\.(mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(mediaUrl) || mediaUrl.includes('/video')));
        if (isVideo) {
            if (!mediaUrl)
                throw new Error("Facebook Reels requires a video to publish.");
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { count, error } = await supabase
                .from('publish_jobs')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', post.user_id)
                .eq('platform', 'facebook')
                .eq('content_type', 'reel')
                .eq('status', 'completed')
                .gte('updated_at', twentyFourHoursAgo);
            if (error)
                throw error;
            if (count && count >= 30) {
                throw new Error('Facebook Reels rate limit reached (30/24h). Delaying job.');
            }
            await this.publishFacebookReel(post, pageToken, pageId, mediaUrl);
            return;
        }
        let res;
        if (mediaUrl) {
            res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/photos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: mediaUrl, message: post.content, access_token: pageToken })
            });
        }
        else {
            res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: post.content, access_token: pageToken })
            });
        }
        const data = await res.json();
        if (data.error)
            throw new Error(data.error.message);
        // Photo posts return { id: <photo id>, post_id: <feed post id> }; text posts return { id: <post id> }.
        await recordPublishedPost(post, 'facebook', data.post_id || data.id, 'post');
        console.log(`[FacebookAdapter] Successfully published to Facebook page ${pageId}`);
    }
    async publishFacebookReel(post, pageToken, pageId, mediaUrl) {
        const startRes = await fetch(`https://graph.facebook.com/v18.0/${pageId}/video_reels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_phase: 'start', access_token: pageToken })
        });
        const startData = await startRes.json();
        if (startData.error)
            throw new Error(`Facebook Start Phase Error: ${startData.error.message}`);
        const videoId = startData.video_id;
        const uploadUrl = startData.upload_url;
        const { buffer: mediaBuffer } = await getMediaBuffer(mediaUrl);
        const totalSize = mediaBuffer.byteLength;
        // Resilient chunked upload: 4 MB chunks prevent server socket timeouts during heavy uploads
        const CHUNK_SIZE = 4 * 1024 * 1024;
        let offset = 0;
        while (offset < totalSize) {
            const end = Math.min(offset + CHUNK_SIZE, totalSize);
            const chunk = mediaBuffer.subarray(offset, end);
            let chunkSuccess = false;
            const pct = Math.round((offset / totalSize) * 100);
            console.log(`[FacebookAdapter] Uploading Reel chunk: ${offset}/${totalSize} bytes (${pct}%)`);
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const uploadRes = await fetch(uploadUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `OAuth ${pageToken}`,
                            'offset': offset.toString(),
                            'file_size': totalSize.toString(),
                            'Content-Type': 'application/octet-stream'
                        },
                        body: chunk
                    });
                    // Meta returns HTTP 206 for intermediate chunks, HTTP 200 for the final chunk
                    if (uploadRes.status === 206 || uploadRes.status === 200) {
                        const data = await uploadRes.json().catch(() => ({}));
                        if (data.error)
                            throw new Error(data.error.message || JSON.stringify(data.error));
                        chunkSuccess = true;
                        break;
                    }
                    else {
                        const errBody = await uploadRes.text().catch(() => '');
                        throw new Error(`rupload returned HTTP ${uploadRes.status}: ${errBody}`);
                    }
                }
                catch (err) {
                    console.warn(`[FacebookAdapter] Chunk at offset ${offset} failed (attempt ${attempt}/3): ${err?.message || err}`);
                    if (attempt === 3)
                        throw err;
                    // Back off and check server's actual committed offset before retrying
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                    try {
                        const checkRes = await fetch(uploadUrl, {
                            method: 'GET',
                            headers: { 'Authorization': `OAuth ${pageToken}` }
                        });
                        if (checkRes.ok) {
                            const checkData = await checkRes.json();
                            if (typeof checkData.offset === 'number' && checkData.offset > offset) {
                                console.log(`[FacebookAdapter] Recovered server offset: ${checkData.offset}/${totalSize}`);
                                offset = checkData.offset;
                                chunkSuccess = true;
                                break;
                            }
                        }
                    }
                    catch { }
                }
            }
            if (!chunkSuccess) {
                throw new Error(`Failed to upload Facebook Reel chunk at offset ${offset} after 3 attempts`);
            }
            offset = end;
        }
        const finishRes = await fetch(`https://graph.facebook.com/v18.0/${pageId}/video_reels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                upload_phase: 'finish',
                video_id: videoId,
                video_state: 'PUBLISHED',
                description: post.content,
                access_token: pageToken
            })
        });
        const finishData = await finishRes.json();
        if (finishData.error)
            throw new Error(`Facebook Finish Phase Error: ${finishData.error.message}`);
        if (finishData.success) {
            await recordPublishedPost(post, 'facebook', videoId, 'video');
            console.log(`[FacebookAdapter] Successfully published Reel to Facebook page ${pageId}`);
        }
        else {
            throw new Error(`Facebook Finish Phase Error: ${JSON.stringify(finishData)}`);
        }
    }
}
class InstagramAdapter {
    async publish(post, account, decryptedToken, contentType, job) {
        console.log(`[InstagramAdapter] Publishing post ${post.id}`);
        let igAccountId = account.provider_account_id;
        if (!igAccountId) {
            const pages = await getFacebookPages(decryptedToken);
            if (!pages || pages.length === 0)
                throw new Error("No Facebook pages found.");
            const pageWithIg = pages.find((p) => p.instagram_business_account);
            if (!pageWithIg)
                throw new Error("No Instagram Business account linked to any of your Facebook pages.");
            igAccountId = pageWithIg.instagram_business_account.id;
        }
        let mediaUrl = null;
        try {
            const media = JSON.parse(post.media_url || '{}');
            mediaUrl = media.instagram || null;
        }
        catch (e) { }
        if (!mediaUrl)
            throw new Error("Instagram requires an image or video to publish.");
        // 1. Create Media Container
        const isVideo = contentType === 'reel' || !!(mediaUrl && (/\.(mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(mediaUrl) || mediaUrl.includes('/video')));
        const body = { caption: post.content, access_token: decryptedToken };
        if (isVideo) {
            body.media_type = 'REELS';
            body.video_url = mediaUrl;
            body.share_to_feed = true;
        }
        else {
            body.image_url = mediaUrl;
        }
        const containerRes = await fetch(`https://graph.facebook.com/v18.0/${igAccountId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const containerData = await containerRes.json();
        if (containerData.error)
            throw new Error(containerData.error.message);
        // 2. Poll for Status if it's a video/reel
        if (isVideo || !body.image_url) {
            let isReady = false;
            let consecutivePollErrors = 0;
            for (let i = 0; i < 36; i++) { // Poll up to 3 minutes (36 * 5s)
                await new Promise(r => setTimeout(r, 5000));
                let statusData = null;
                try {
                    const statusRes = await fetch(`https://graph.facebook.com/v18.0/${containerData.id}?fields=status_code&access_token=${decryptedToken}`);
                    statusData = await statusRes.json();
                    consecutivePollErrors = 0;
                }
                catch (pollErr) {
                    consecutivePollErrors++;
                    console.warn(`[InstagramAdapter] Poll attempt ${i + 1} network blip (${consecutivePollErrors}/5):`, pollErr.cause?.message || pollErr.message);
                    if (consecutivePollErrors >= 5) {
                        throw new Error(`Instagram media container polling failed after 5 consecutive network errors: ${pollErr.cause?.message || pollErr.message}`);
                    }
                    continue;
                }
                if (statusData?.status_code === 'FINISHED') {
                    isReady = true;
                    break;
                }
                else if (statusData?.status_code === 'ERROR') {
                    throw new Error('Instagram media container processing failed.');
                }
                else {
                    console.log(`[InstagramAdapter] Container ${containerData.id} status: ${statusData?.status_code || 'IN_PROGRESS'} (poll ${i + 1}/36)`);
                }
            }
            if (!isReady) {
                throw new Error('Media ID is not available (timed out waiting for video processing)');
            }
        }
        // 3. Publish Media Container
        const publishRes = await fetch(`https://graph.facebook.com/v18.0/${igAccountId}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: containerData.id, access_token: decryptedToken })
        });
        const publishData = await publishRes.json();
        if (publishData.error)
            throw new Error(publishData.error.message);
        await recordPublishedPost(post, 'instagram', publishData.id, contentType === 'reel' ? 'reel' : 'post');
        console.log(`[InstagramAdapter] Successfully published to IG account ${igAccountId}`);
    }
}
// Uploads are public by default. Override with YOUTUBE_PRIVACY=unlisted|private (e.g. for testing).
// Note: Google can force uploads from an unaudited API project to private regardless of this setting.
const YOUTUBE_PRIVACY = ["public", "unlisted", "private"].includes(process.env.YOUTUBE_PRIVACY || "") ? process.env.YOUTUBE_PRIVACY : "public";
class YouTubeAdapter {
    async publish(post, account, decryptedToken, contentType, job) {
        console.log(`[YouTubeAdapter] Publishing post ${post.id} (Type: ${contentType || 'post'})`);
        let activeToken = decryptedToken;
        try {
            const refreshRes = await fetch(`${ACCOUNT_SERVICE_URL}/api/v1/auth/youtube/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: account.id })
            });
            const refreshData = await refreshRes.json();
            if (refreshData.success) {
                activeToken = refreshData.accessToken;
            }
        }
        catch (e) {
            console.warn('YouTube token refresh failed, attempting with existing token', e);
        }
        let mediaUrl = null;
        try {
            const media = JSON.parse(post.media_url || '{}');
            mediaUrl = media.youtube || null;
        }
        catch (e) { }
        if (!mediaUrl)
            throw new Error("YouTube requires a video to publish.");
        if (mediaUrl.endsWith('.jpg') || mediaUrl.endsWith('.jpeg') || mediaUrl.endsWith('.png')) {
            throw new Error("YouTube only accepts video files. You provided an image.");
        }
        // Download or retrieve cached video buffer
        const { buffer: videoBuffer } = await getMediaBuffer(mediaUrl);
        const fileSize = videoBuffer.byteLength;
        const totalMb = (fileSize / (1024 * 1024)).toFixed(1);
        // Check for existing session
        const { data: session } = await supabase.from('youtube_upload_sessions')
            .select('*')
            .eq('post_id', post.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        // If an upload session was already marked completed with a valid video_id, record and finish!
        if (session && session.status === 'completed' && session.video_id) {
            console.log(`[YouTubeAdapter] Post ${post.id} already completed upload with video_id: ${session.video_id}`);
            await recordPublishedPost(post, 'youtube', session.video_id, 'video');
            return;
        }
        let sessionUri = session?.session_uri;
        let offset = 0;
        let videoId = session?.video_id || null;
        // If we have an existing session URI, query Google for the committed byte offset
        if (sessionUri) {
            try {
                console.log(`[YouTubeAdapter] Checking existing upload session status for post ${post.id}...`);
                const queryRes = await fetch(sessionUri, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${activeToken}`,
                        'Content-Range': `bytes */${fileSize}`,
                        'Content-Length': '0'
                    }
                });
                if (queryRes.status === 200 || queryRes.status === 201) {
                    const finishedData = await queryRes.json().catch(() => ({}));
                    if (finishedData.id) {
                        videoId = finishedData.id;
                        console.log(`[YouTubeAdapter] Existing session already completed on YouTube: ${videoId}`);
                    }
                }
                else if (queryRes.status === 308) {
                    const rangeHdr = queryRes.headers.get('Range');
                    if (rangeHdr) {
                        const m = rangeHdr.match(/bytes=0-(\d+)/);
                        if (m) {
                            offset = parseInt(m[1], 10) + 1;
                            console.log(`[YouTubeAdapter] Resuming existing session from offset: ${(offset / (1024 * 1024)).toFixed(1)}/${totalMb} MB`);
                        }
                    }
                }
                else {
                    console.log(`[YouTubeAdapter] Existing session query returned HTTP ${queryRes.status}, starting new session.`);
                    sessionUri = null;
                }
            }
            catch (err) {
                console.warn(`[YouTubeAdapter] Could not query existing session, starting fresh:`, err?.message || err);
                sessionUri = null;
            }
        }
        // Initialize a new session if needed
        if (!sessionUri && !videoId) {
            const lines = (post.content || '').split('\n').map((l) => l.trim()).filter(Boolean);
            let youtubeTitle = (lines[0] || 'SocialPush Video').replace(/[\r\n\t]+/g, ' ').trim();
            if (youtubeTitle.length > 100) {
                youtubeTitle = youtubeTitle.substring(0, 97) + '...';
            }
            console.log(`[YouTubeAdapter] Initializing new resumable upload session (${totalMb} MB, title: "${youtubeTitle}")...`);
            const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${activeToken}`,
                    'X-Upload-Content-Length': fileSize.toString(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    snippet: {
                        title: youtubeTitle,
                        description: contentType === 'reel' ? `${post.content}\n\n#Shorts` : post.content
                    },
                    status: { privacyStatus: YOUTUBE_PRIVACY }
                })
            });
            if (!initRes.ok) {
                const errorText = await initRes.text();
                throw new Error(`Failed to init YouTube upload: ${errorText}`);
            }
            sessionUri = initRes.headers.get('location');
            if (!sessionUri)
                throw new Error("No session URI returned from YouTube");
            await supabase.from('youtube_upload_sessions').upsert({
                post_id: post.id,
                user_id: account.user_id,
                session_uri: sessionUri,
                bytes_uploaded: 0,
                status: 'in_progress'
            }, { onConflict: 'post_id' });
        }
        // 2. Upload bytes in 4 MB chunks (Google requires multiples of 256 KB = 262,144 bytes)
        const CHUNK_SIZE = 4 * 1024 * 1024;
        while (!videoId && offset < fileSize) {
            const end = Math.min(offset + CHUNK_SIZE, fileSize);
            const chunk = videoBuffer.subarray(offset, end);
            const contentRange = `bytes ${offset}-${end - 1}/${fileSize}`;
            const percent = Math.round((end / fileSize) * 100);
            const uploadedMb = (end / (1024 * 1024)).toFixed(1);
            console.log(`[YouTubeAdapter] Uploading video chunk: ${uploadedMb}/${totalMb} MB (${percent}%) [Range: ${offset}-${end - 1}]`);
            let chunkSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const chunkRes = await fetch(sessionUri, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${activeToken}`,
                            'Content-Type': 'video/mp4',
                            'Content-Range': contentRange,
                            'Content-Length': chunk.byteLength.toString()
                        },
                        body: chunk
                    });
                    if (chunkRes.status === 200 || chunkRes.status === 201) {
                        const data = await chunkRes.json();
                        videoId = data.id;
                        chunkSuccess = true;
                        offset = end;
                        break;
                    }
                    else if (chunkRes.status === 308) {
                        // Google HTTP 308 Resume Incomplete
                        const rangeHdr = chunkRes.headers.get('Range');
                        if (rangeHdr) {
                            const m = rangeHdr.match(/bytes=0-(\d+)/);
                            if (m) {
                                offset = parseInt(m[1], 10) + 1;
                            }
                            else {
                                offset = end;
                            }
                        }
                        else {
                            offset = end;
                        }
                        chunkSuccess = true;
                        break;
                    }
                    else {
                        const errText = await chunkRes.text().catch(() => '');
                        throw new Error(`Google upload returned HTTP ${chunkRes.status}: ${errText}`);
                    }
                }
                catch (chunkErr) {
                    console.warn(`[YouTubeAdapter] Chunk at offset ${offset} failed (attempt ${attempt}/3): ${chunkErr?.message || chunkErr}`);
                    if (attempt === 3)
                        throw chunkErr;
                    // Back off and recover committed offset from Google before retrying
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                    try {
                        const recRes = await fetch(sessionUri, {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${activeToken}`,
                                'Content-Range': `bytes */${fileSize}`,
                                'Content-Length': '0'
                            }
                        });
                        if (recRes.status === 200 || recRes.status === 201) {
                            const recData = await recRes.json().catch(() => ({}));
                            if (recData.id) {
                                videoId = recData.id;
                                chunkSuccess = true;
                                offset = fileSize;
                                break;
                            }
                        }
                        else if (recRes.status === 308) {
                            const recRange = recRes.headers.get('Range');
                            if (recRange) {
                                const m = recRange.match(/bytes=0-(\d+)/);
                                if (m) {
                                    const recOffset = parseInt(m[1], 10) + 1;
                                    if (recOffset > offset) {
                                        console.log(`[YouTubeAdapter] Recovered server offset: ${(recOffset / (1024 * 1024)).toFixed(1)}/${totalMb} MB`);
                                        offset = recOffset;
                                        chunkSuccess = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    catch { }
                }
            }
            if (!chunkSuccess) {
                if (sessionUri) {
                    await supabase.from('youtube_upload_sessions').update({ status: 'failed' }).eq('session_uri', sessionUri);
                }
                throw new Error(`Failed to upload YouTube chunk at offset ${offset} after 3 attempts`);
            }
        }
        if (!videoId) {
            throw new Error("YouTube upload finished without returning a video ID");
        }
        if (sessionUri) {
            await supabase.from('youtube_upload_sessions').update({
                bytes_uploaded: fileSize,
                status: 'completed',
                video_id: videoId
            }).eq('session_uri', sessionUri);
        }
        // 3. Immediately record published post!
        await recordPublishedPost(post, 'youtube', videoId, 'video');
        console.log(`[YouTubeAdapter] Video ${videoId} successfully published and recorded to published_posts.`);
        // 4. Poll status (best-effort, does not block or fail already published video)
        try {
            await this.getStatus(videoId, activeToken, post.id);
        }
        catch (statusErr) {
            console.warn(`[YouTubeAdapter] Status check note for video ${videoId}:`, statusErr?.message || statusErr);
        }
    }
    async getStatus(videoId, token, postId) {
        let isProcessed = false;
        let attempts = 0;
        await supabase.from('posts').update({ status: 'processing' }).eq('id', postId);
        while (!isProcessed && attempts < 12) {
            attempts++;
            const res = await fetch(`https://youtube.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${videoId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.items && data.items.length > 0) {
                const status = data.items[0].status;
                const uploadStatus = status.uploadStatus;
                if (uploadStatus === 'processed') {
                    isProcessed = true;
                    break;
                }
                else if (uploadStatus === 'rejected' || uploadStatus === 'failed') {
                    throw new Error(`YouTube processing failed: ${status.rejectionReason || status.failureReason}`);
                }
            }
            // Wait 5 seconds before polling again
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        if (!isProcessed) {
            console.log(`[YouTubeAdapter] Video ${videoId} is still processing, continuing anyway to avoid timeout.`);
        }
        else {
            console.log(`[YouTubeAdapter] Video ${videoId} processed successfully.`);
        }
    }
}
// LinkedIn versions the REST API by YYYYMM and retires each after ~1 year; override via env if it goes stale.
const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION || '202606';
class LinkedInAdapter {
    async publish(post, account, decryptedToken, contentType, job) {
        console.log(`[LinkedInAdapter] Publishing post ${post.id} via LinkedIn REST API...`);
        // Determine Author URN
        let authorUrn = `urn:li:person:${account.provider_account_id}`;
        if (account.target_type === 'organization' && account.organization_urn) {
            // In case they store it without prefix, ensure it's a full URN
            authorUrn = account.organization_urn.startsWith('urn:li:organization:')
                ? account.organization_urn
                : `urn:li:organization:${account.organization_urn}`;
        }
        let mediaUrl = null;
        try {
            const media = JSON.parse(post.media_url || '{}');
            mediaUrl = media.linkedin || mediaUrl;
        }
        catch (e) { }
        let mediaUrn = null;
        // 1. Upload Media if present
        if (mediaUrl) {
            console.log(`[LinkedInAdapter] Uploading media for post ${post.id}...`);
            const { buffer: mediaBuffer, mime } = await getMediaBuffer(mediaUrl);
            const isVideo = contentType === 'reel' || mediaUrl.match(/\.(mp4|mov|avi|mkv)(\?.*)?$/i) || mime.startsWith('video/');
            const action = isVideo ? 'videos' : 'images';
            // Initialize Upload
            const initRes = await fetch(`https://api.linkedin.com/rest/${action}?action=initializeUpload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${decryptedToken}`,
                    'Linkedin-Version': LINKEDIN_API_VERSION,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    initializeUploadRequest: isVideo
                        ? { owner: authorUrn, fileSizeBytes: mediaBuffer.byteLength, uploadCaptions: false, uploadThumbnail: false }
                        : { owner: authorUrn }
                })
            });
            const initData = await initRes.json();
            if (initData.status && initData.status >= 400) {
                throw new Error(`LinkedIn Media Init Error: ${JSON.stringify(initData)}`);
            }
            if (isVideo) {
                // Videos are uploaded in the byte ranges LinkedIn hands back (one PUT per range), then finalized.
                mediaUrn = initData.value.video;
                const uploadedPartIds = [];
                for (const part of initData.value.uploadInstructions) {
                    const partRes = await fetch(part.uploadUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: Buffer.from(mediaBuffer.slice(part.firstByte, part.lastByte + 1))
                    });
                    if (!partRes.ok) {
                        const errText = await partRes.text();
                        throw new Error(`LinkedIn Media Upload Error: ${errText}`);
                    }
                    uploadedPartIds.push(partRes.headers.get('etag') || '');
                }
                const finalizeRes = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${decryptedToken}`,
                        'Linkedin-Version': LINKEDIN_API_VERSION,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        finalizeUploadRequest: { video: mediaUrn, uploadToken: initData.value.uploadToken || '', uploadedPartIds }
                    })
                });
                if (!finalizeRes.ok) {
                    const errText = await finalizeRes.text();
                    throw new Error(`LinkedIn Media Finalize Error: ${errText}`);
                }
            }
            else {
                mediaUrn = initData.value.image;
                const uploadRes = await fetch(initData.value.uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${decryptedToken}`,
                        'Content-Type': 'application/octet-stream'
                    },
                    body: Buffer.from(mediaBuffer)
                });
                if (!uploadRes.ok) {
                    const errText = await uploadRes.text();
                    throw new Error(`LinkedIn Media Upload Error: ${errText}`);
                }
            }
        }
        // 2. Create Post
        console.log(`[LinkedInAdapter] Creating final post ${post.id}...`);
        const postBody = {
            author: authorUrn,
            commentary: post.content,
            visibility: 'PUBLIC',
            distribution: {
                feedDistribution: 'MAIN_FEED',
                targetEntities: [],
                thirdPartyDistributionChannels: []
            },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false
        };
        if (mediaUrn) {
            postBody.content = {
                media: {
                    id: mediaUrn
                }
            };
        }
        const postRes = await fetch('https://api.linkedin.com/rest/posts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${decryptedToken}`,
                'Linkedin-Version': LINKEDIN_API_VERSION,
                'Content-Type': 'application/json',
                'X-Restli-Protocol-Version': '2.0.0'
            },
            body: JSON.stringify(postBody)
        });
        if (!postRes.ok) {
            const errText = await postRes.text();
            throw new Error(`LinkedIn Post Error: ${errText}`);
        }
        // LinkedIn returns the new post's URN in the x-restli-id header.
        await recordPublishedPost(post, 'linkedin', postRes.headers.get('x-restli-id'), 'post');
        console.log(`[LinkedInAdapter] Successfully published post ${post.id} to LinkedIn`);
    }
}
class TikTokAdapter {
    async publish(post, account, decryptedToken, contentType, job) {
        // TikTok publishing is not implemented (accounts are connected with mock tokens). Failing honestly lets the user see
        // a failure notification and a Failed status instead of a false "successfully published".
        throw new Error('TikTok publishing is not implemented yet.');
    }
}
// Trial-access Pinterest apps can only call the sandbox host; set PINTEREST_API_BASE=https://api-sandbox.pinterest.com to test there.
const PINTEREST_API_BASE = process.env.PINTEREST_API_BASE || 'https://api.pinterest.com';
// Trial-access apps get 401 in the sandbox with a normal OAuth token; the sandbox needs the token generated in the Pinterest developer portal.
const pinterestToken = (oauthToken) => PINTEREST_API_BASE.includes('sandbox') && process.env.PINTEREST_SANDBOX_TOKEN ? process.env.PINTEREST_SANDBOX_TOKEN : oauthToken;
// post.media_url is a JSON map of platform -> URL (see ARCHITECTURE.md); fall back to a plain URL string.
function pinterestMediaUrl(post) {
    try {
        const media = JSON.parse(post.media_url || '{}');
        return media.pinterest || null;
    }
    catch (e) {
        return post.media_url || null;
    }
}
class PinterestAdapter {
    async publish(post, account, decryptedToken, contentType, job) {
        const token = pinterestToken(decryptedToken);
        console.log(`[PinterestAdapter] Publishing post ${post.id} via Pinterest API...`);
        let boardId = job?.pinterest_board_id;
        if (!boardId) {
            const { data: board } = await supabase.from('pinterest_boards')
                .select('pinterest_board_id')
                .eq('social_account_id', account.id)
                .eq('is_default', true)
                .single();
            if (!board) {
                throw new Error('Pinterest Publish Error: No board ID specified and no default board found.');
            }
            boardId = board.pinterest_board_id;
        }
        const title = post.content ? post.content.substring(0, 95) : 'Pin';
        const description = post.content || '';
        if (contentType === 'reel') {
            const registerRes = await fetch(`${PINTEREST_API_BASE}/v5/media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ media_type: 'video' })
            });
            const registerData = await registerRes.json();
            if (!registerRes.ok)
                throw new Error(`Pinterest Media Registration Error: ${registerData.message || JSON.stringify(registerData)}`);
            const { media_id, upload_url, upload_parameters } = registerData;
            const videoUrl = pinterestMediaUrl(post);
            if (!videoUrl)
                throw new Error('No video URL provided for Pinterest Reel');
            const { buffer: videoBuffer } = await getMediaBuffer(videoUrl);
            const formData = new FormData();
            for (const key in upload_parameters) {
                formData.append(key, upload_parameters[key]);
            }
            formData.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), 'video.mp4');
            const uploadRes = await fetch(upload_url, {
                method: 'POST',
                body: formData
            });
            if (!uploadRes.ok) {
                const errText = await uploadRes.text();
                throw new Error(`Pinterest S3 Upload Error: ${errText}`);
            }
            await new Promise(r => setTimeout(r, 5000));
            const pinRes = await fetch(`${PINTEREST_API_BASE}/v5/pins`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    board_id: boardId,
                    title: title,
                    description: description,
                    media_source: {
                        source_type: 'video_id',
                        cover_image_key_frame_time: 0,
                        media_id: media_id
                    }
                })
            });
            const pinData = await pinRes.json();
            if (!pinRes.ok)
                throw new Error(`Pinterest Video Pin Error: ${pinData.message || JSON.stringify(pinData)}`);
            // Store the pin_id for analytics
            if (pinData.id) {
                await supabase.from('pinterest_published_pins').upsert({
                    post_id: post.id,
                    pin_id: pinData.id,
                    user_id: post.user_id
                }, { onConflict: 'post_id' });
            }
        }
        else {
            const imageUrl = pinterestMediaUrl(post);
            if (!imageUrl)
                throw new Error('No image URL provided for Pinterest Pin');
            const pinRes = await fetch(`${PINTEREST_API_BASE}/v5/pins`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    board_id: boardId,
                    title: title,
                    description: description,
                    media_source: {
                        source_type: 'image_url',
                        url: imageUrl
                    }
                })
            });
            const pinData = await pinRes.json();
            if (!pinRes.ok)
                throw new Error(`Pinterest Image Pin Error: ${pinData.message || JSON.stringify(pinData)}`);
            // Store the pin_id for analytics
            if (pinData.id) {
                await supabase.from('pinterest_published_pins').upsert({
                    post_id: post.id,
                    pin_id: pinData.id,
                    user_id: post.user_id
                }, { onConflict: 'post_id' });
            }
        }
        console.log(`[PinterestAdapter] Successfully published post ${post.id} to Pinterest (Board: ${boardId})`);
    }
}
class ThreadsAdapter {
    async publish(post, account, decryptedToken, contentType, job) {
        console.log(`[ThreadsAdapter] Publishing post ${post.id}`);
        // Check text byte length
        const textBytes = Buffer.byteLength(post.content || '', 'utf8');
        if (textBytes > 500) {
            throw new Error("Threads text exceeds 500 UTF-8 bytes limit.");
        }
        // Check rate limit
        const limitRes = await fetch(`https://graph.threads.net/v1.0/me/threads_publishing_limit?fields=quota_usage,quota_total&access_token=${decryptedToken}`);
        const limitData = await limitRes.json();
        if (limitData.data && limitData.data.length > 0) {
            const quota = limitData.data[0];
            if (quota.quota_usage >= quota.quota_total) {
                throw new Error('Threads rate limit reached (250/24h). Delaying job.');
            }
        }
        let mediaUrl = null;
        try {
            const media = JSON.parse(post.media_url || '{}');
            mediaUrl = media.threads || null;
        }
        catch (e) { }
        const body = { text: post.content, access_token: decryptedToken };
        if (mediaUrl) {
            const isVideo = contentType === 'reel' || mediaUrl.match(/\.(mp4|mov|avi|mkv)(\?.*)?$/i);
            if (isVideo) {
                body.media_type = 'VIDEO';
                body.video_url = mediaUrl;
            }
            else {
                body.media_type = 'IMAGE';
                body.image_url = mediaUrl;
            }
        }
        else {
            body.media_type = 'TEXT';
        }
        // 1. Create Container
        let containerRes;
        try {
            containerRes = await fetch(`https://graph.threads.net/v1.0/me/threads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }
        catch (netErr) {
            throw new Error(`Threads container creation network error: ${netErr.cause?.message || netErr.message}`);
        }
        let containerData = {};
        try {
            containerData = await containerRes.json();
        }
        catch {
            throw new Error(`Threads container creation returned invalid response (HTTP ${containerRes.status})`);
        }
        if (containerData.error) {
            throw new Error(`Threads API Error (${containerData.error.code || 'unknown'}): ${containerData.error.message}`);
        }
        if (!containerData.id) {
            throw new Error(`Threads container creation failed: No container ID returned`);
        }
        console.log(`[ThreadsAdapter] Container created: ${containerData.id}`);
        // 2. Poll for status if media
        if (body.media_type !== 'TEXT') {
            let isReady = false;
            let consecutivePollErrors = 0;
            for (let i = 0; i < 36; i++) { // Poll up to 3 mins (36 * 5s)
                await new Promise(r => setTimeout(r, 5000));
                let statusData = null;
                try {
                    const statusRes = await fetch(`https://graph.threads.net/v1.0/${containerData.id}?fields=status,error_message&access_token=${decryptedToken}`);
                    statusData = await statusRes.json();
                    consecutivePollErrors = 0;
                }
                catch (pollErr) {
                    consecutivePollErrors++;
                    console.warn(`[ThreadsAdapter] Poll attempt ${i + 1} network blip (${consecutivePollErrors}/5):`, pollErr.cause?.message || pollErr.message);
                    if (consecutivePollErrors >= 5) {
                        throw new Error(`Threads media container polling failed after 5 consecutive network errors: ${pollErr.cause?.message || pollErr.message}`);
                    }
                    continue; // Don't abort the entire job for 1 transient network blip
                }
                if (statusData?.status === 'FINISHED') {
                    isReady = true;
                    break;
                }
                else if (statusData?.status === 'ERROR') {
                    throw new Error(`Threads media container processing failed: ${statusData.error_message || 'Unknown Meta error'}`);
                }
                else {
                    console.log(`[ThreadsAdapter] Container ${containerData.id} status: ${statusData?.status || 'IN_PROGRESS'} (poll ${i + 1}/36)`);
                }
            }
            if (!isReady) {
                throw new Error('Threads media container timed out waiting for processing (took > 3 mins).');
            }
        }
        // 3. Publish
        let publishRes;
        try {
            publishRes = await fetch(`https://graph.threads.net/v1.0/me/threads_publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creation_id: containerData.id, access_token: decryptedToken })
            });
        }
        catch (netErr) {
            throw new Error(`Threads publish network error: ${netErr.cause?.message || netErr.message}`);
        }
        let publishData = {};
        try {
            publishData = await publishRes.json();
        }
        catch {
            throw new Error(`Threads publish returned invalid response (HTTP ${publishRes.status})`);
        }
        if (publishData.error) {
            throw new Error(`Threads Publish API Error (${publishData.error.code || 'unknown'}): ${publishData.error.message}`);
        }
        await recordPublishedPost(post, 'threads', publishData.id, contentType === 'reel' ? 'reel' : 'post');
        console.log(`[ThreadsAdapter] Successfully published post ${post.id}`);
    }
}
const adapters = {
    twitter: new TwitterAdapter(),
    facebook: new FacebookAdapter(),
    instagram: new InstagramAdapter(),
    youtube: new YouTubeAdapter(),
    linkedin: new LinkedInAdapter(),
    tiktok: new TikTokAdapter(),
    pinterest: new PinterestAdapter(),
    threads: new ThreadsAdapter(),
};
app.post('/api/v1/publish/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const startTime = Date.now();
    console.log(`[PublishingService] [${new Date().toISOString()}] Incoming publish request for job: ${jobId}`);
    const { data: job, error: jobError } = await supabase.from('publish_jobs').select('*').eq('id', jobId).single();
    if (jobError || !job) {
        console.warn(`[PublishingService] Job ${jobId} not found in database`);
        return res.status(404).json({ error: 'Job not found' });
    }
    console.log(`[PublishingService] Processing job ${jobId}: platform=${job.platform}, content_type=${job.content_type || 'post'}`);
    // Idempotency guard: a worker crash or BullMQ stalled-job redelivery can call this endpoint again for a job
    // that already published successfully (the actual platform call and recordPublishedPost() below both finished,
    // but the worker died before it could mark the job 'completed'). Without this check that replay would post the
    // same content to the platform a second time. `published_posts` is the source of truth for "did this post_id +
    // platform combination already go out", since adapter.publish() only records it after a real success.
    if (job.status === 'completed') {
        return res.json({ success: true, message: `Already published to ${job.platform} (job already completed).` });
    }
    const { data: already } = await supabase.from('published_posts').select('id').eq('post_id', job.post_id).eq('platform', job.platform).maybeSingle();
    if (already) {
        return res.json({ success: true, message: `Already published to ${job.platform} (found an existing record).` });
    }
    // Rate Limiting Check
    if (shared_1.publishRateLimiter) {
        const { success, limit, remaining, reset } = await shared_1.publishRateLimiter.limit(`publish_${job.user_id}`);
        res.set('X-RateLimit-Limit', limit.toString());
        res.set('X-RateLimit-Remaining', remaining.toString());
        res.set('X-RateLimit-Reset', reset.toString());
        if (!success) {
            return res.status(429).json({ error: 'Too Many Requests. You can only publish 5 posts per minute.' });
        }
    }
    const { data: post, error: postError } = await supabase.from('posts').select('*').eq('id', job.post_id).single();
    if (postError || !post)
        return res.status(404).json({ error: 'Post not found' });
    const { data: account, error: accError } = await supabase.from('social_accounts')
        .select('*').eq('user_id', post.user_id).eq('platform', job.platform).single();
    if (accError || !account)
        return res.status(404).json({ error: `${job.platform} account not connected` });
    const adapter = adapters[job.platform];
    if (!adapter)
        return res.status(400).json({ error: `No adapter found for ${job.platform}` });
    try {
        const accessToken = decrypt(account.access_token_encrypted);
        await adapter.publish(post, account, accessToken, job.content_type, job);
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[PublishingService] [SUCCESS] Published job ${jobId} to ${job.platform} in ${durationSec}s`);
        res.json({ success: true, message: `Published to ${job.platform}` });
    }
    catch (error) {
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const detail = error?.cause?.message ? `${error.message} (${error.cause.message})` : (error?.message || 'Failed to publish');
        console.error(`[PublishingService] [ERROR] Job ${jobId} (${job.platform}) failed after ${durationSec}s:`, detail);
        if (detail.includes('rate limit reached')) {
            return res.status(429).json({ error: detail });
        }
        res.status(500).json({ error: detail });
    }
});
const PORT = process.env.PORT || 3003;
const server = app.listen(PORT, () => console.log(`Publishing Service listening on port ${PORT}`));
// Crucial for long video uploads and polling loops: prevent Node 18/20/22 default 60s headersTimeout
server.headersTimeout = 600_000; // 10 minutes
server.requestTimeout = 600_000; // 10 minutes
server.keepAliveTimeout = 60_000; // 1 minute
server.timeout = 600_000; // 10 minutes
server.on('clientError', (err, socket) => {
    if (err?.code === 'ECONNRESET' || !socket.writable)
        return;
    console.warn('[PublishingService] Client socket error:', err.message || err);
    try {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
    catch { }
});
