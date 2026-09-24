import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { TwitterApi } from 'twitter-api-v2';
import { createClient } from '@supabase/supabase-js';
import { publishRateLimiter } from '@socialpush/shared';

dotenv.config({ path: path.join(__dirname, '../../../.env') });
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';
// Server-to-server call, not exposed to the browser - a plain env var (not NEXT_PUBLIC_*) is enough.
const ACCOUNT_SERVICE_URL = process.env.ACCOUNT_SERVICE_URL || 'http://localhost:3001';

function decrypt(text: string) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

interface PlatformAdapter {
  publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any): Promise<void>;
}

class TwitterAdapter implements PlatformAdapter {
  async publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any) {
    const client = new TwitterApi(decryptedToken);
    // Note: Twitter API requires media ID upload for attachments. 
    // Kept simple for text MVP execution to prove adapter flow.
    await client.v2.tweet(post.content); 
    console.log(`[TwitterAdapter] Published post ${post.id}`);
  }
}

async function getFacebookPages(decryptedToken: string) {
  let pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${decryptedToken}`);
  let pagesData = await pagesRes.json();
  
  if (pagesData.data && pagesData.data.length > 0) {
    return pagesData.data;
  }
  
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return [];
  
  const debugRes = await fetch(`https://graph.facebook.com/v18.0/debug_token?input_token=${decryptedToken}&access_token=${appId}|${appSecret}`);
  const debugData = await debugRes.json();
  
  const targetIds = new Set<string>();
  if (debugData.data?.granular_scopes) {
    for (const scope of debugData.data.granular_scopes) {
      if (scope.target_ids) {
        scope.target_ids.forEach((id: string) => targetIds.add(id));
      }
    }
  }
  
  const pages = [];
  for (const pageId of targetIds) {
    try {
      const pRes = await fetch(`https://graph.facebook.com/v18.0/${pageId}?fields=id,name,access_token,instagram_business_account&access_token=${decryptedToken}`);
      const pData = await pRes.json();
      if (pData.access_token) pages.push(pData);
    } catch (e) {}
  }
  return pages;
}

class FacebookAdapter implements PlatformAdapter {
  async publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any) {
    console.log(`[FacebookAdapter] Publishing post ${post.id}`);
    
    const pages = await getFacebookPages(decryptedToken);
    if (!pages || pages.length === 0) throw new Error("No Facebook pages found for this user.");
    
    // Default to the first page for automated flow
    const page = pages[0];
    const pageToken = page.access_token;
    const pageId = page.id;
    
    let mediaUrl = null;
    try {
      const media = JSON.parse(post.media_url || '{}');
      mediaUrl = media.facebook || null;
    } catch (e) {}
    
    if (contentType === 'reel') {
      if (!mediaUrl) throw new Error("Facebook Reels requires a video to publish.");
      
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from('publish_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', post.user_id)
        .eq('platform', 'facebook')
        .eq('content_type', 'reel')
        .eq('status', 'completed')
        .gte('updated_at', twentyFourHoursAgo);
        
      if (error) throw error;
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
    } else {
      res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: post.content, access_token: pageToken })
      });
    }
    
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    console.log(`[FacebookAdapter] Successfully published to Facebook page ${pageId}`);
  }

  private async publishFacebookReel(post: any, pageToken: string, pageId: string, mediaUrl: string) {
    const startRes = await fetch(`https://graph.facebook.com/v18.0/${pageId}/video_reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_phase: 'start', access_token: pageToken })
    });
    const startData = await startRes.json();
    if (startData.error) throw new Error(`Facebook Start Phase Error: ${startData.error.message}`);
    
    const videoId = startData.video_id;
    const uploadUrl = startData.upload_url;

    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) throw new Error(`Failed to fetch media from ${mediaUrl}`);
    const mediaBuffer = await mediaRes.arrayBuffer();

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 
        'Authorization': `OAuth ${pageToken}`,
        'offset': '0',
        'file_size': mediaBuffer.byteLength.toString(),
        'Content-Type': 'application/octet-stream'
      },
      body: Buffer.from(mediaBuffer)
    });
    const uploadData = await uploadRes.json();
    if (uploadData.error) throw new Error(`Facebook Upload Phase Error: ${uploadData.error.message}`);

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
    if (finishData.error) throw new Error(`Facebook Finish Phase Error: ${finishData.error.message}`);
    
    if (finishData.success) {
      console.log(`[FacebookAdapter] Successfully published Reel to Facebook page ${pageId}`);
    } else {
      throw new Error(`Facebook Finish Phase Error: ${JSON.stringify(finishData)}`);
    }
  }
}

class InstagramAdapter implements PlatformAdapter {
  async publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any) {
    console.log(`[InstagramAdapter] Publishing post ${post.id}`);
    
    const pages = await getFacebookPages(decryptedToken);
    if (!pages || pages.length === 0) throw new Error("No Facebook pages found.");
    
    const pageWithIg = pages.find((p: any) => p.instagram_business_account);
    if (!pageWithIg) throw new Error("No Instagram Business account linked to any of your Facebook pages.");
    
    const igAccountId = pageWithIg.instagram_business_account.id;
    
    let mediaUrl = null;
    try {
      const media = JSON.parse(post.media_url || '{}');
      mediaUrl = media.instagram || null;
    } catch (e) {}
    
    if (!mediaUrl) throw new Error("Instagram requires an image or video to publish.");
    
    // 1. Create Media Container
    const body: any = { caption: post.content, access_token: decryptedToken };
    
    if (contentType === 'reel') {
      body.media_type = 'REELS';
      body.video_url = mediaUrl;
      body.share_to_feed = true;
    } else {
      body.image_url = mediaUrl;
    }

    const containerRes = await fetch(`https://graph.facebook.com/v18.0/${igAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const containerData = await containerRes.json();
    if (containerData.error) throw new Error(containerData.error.message);
    
    // 2. Poll for Status if it's a video/reel
    if (contentType === 'reel' || !body.image_url) {
      let isReady = false;
      for (let i = 0; i < 24; i++) { // Poll up to 2 minutes (24 * 5s)
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await fetch(`https://graph.facebook.com/v18.0/${containerData.id}?fields=status_code&access_token=${decryptedToken}`);
        const statusData = await statusRes.json();
        if (statusData.status_code === 'FINISHED') {
          isReady = true;
          break;
        } else if (statusData.status_code === 'ERROR') {
          throw new Error('Instagram media container processing failed.');
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
    if (publishData.error) throw new Error(publishData.error.message);
    
    console.log(`[InstagramAdapter] Successfully published to IG account ${igAccountId}`);
  }
}

class YouTubeAdapter implements PlatformAdapter {
  async publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any) {
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
    } catch(e) {
      console.warn('YouTube token refresh failed, attempting with existing token', e);
    }
    
    let mediaUrl = null;
    try {
      const media = JSON.parse(post.media_url || '{}');
      mediaUrl = media.youtube || null;
    } catch (e) {}
    
    if (!mediaUrl) throw new Error("YouTube requires a video to publish.");
    if (mediaUrl.endsWith('.jpg') || mediaUrl.endsWith('.jpeg') || mediaUrl.endsWith('.png')) {
      throw new Error("YouTube only accepts video files. You provided an image.");
    }
    
    // Check for existing session
    const { data: session } = await supabase.from('youtube_upload_sessions').select('*').eq('post_id', post.id).eq('status', 'in_progress').maybeSingle();
    
    let sessionUri = session?.session_uri;
    
    // Download video to memory
    const mediaRes = await fetch(mediaUrl);
    const videoBuffer = await mediaRes.arrayBuffer();
    const fileSize = videoBuffer.byteLength;
    
    if (!sessionUri) {
      // 1. Init session
      const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeToken}`,
          'X-Upload-Content-Length': fileSize.toString(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          snippet: { 
            title: post.content.substring(0, 100) || 'SocialPush Video',
            description: contentType === 'reel' ? `${post.content}\n#Shorts` : post.content
          },
          status: { privacyStatus: 'unlisted' }
        })
      });
      
      if (!initRes.ok) {
        const errorText = await initRes.text();
        throw new Error(`Failed to init YouTube upload: ${errorText}`);
      }
      
      sessionUri = initRes.headers.get('location');
      
      if (!sessionUri) throw new Error("No session URI returned from YouTube");
      
      await supabase.from('youtube_upload_sessions').insert({
        post_id: post.id,
        user_id: account.user_id,
        session_uri: sessionUri,
        bytes_uploaded: 0,
        status: 'in_progress'
      });
    }
    
    // 2. Upload bytes
    const uploadRes = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${activeToken}`,
        'Content-Length': fileSize.toString(),
        'Content-Type': 'video/mp4'
      },
      body: videoBuffer
    });
    
    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      await supabase.from('youtube_upload_sessions').update({
        status: 'failed'
      }).eq('session_uri', sessionUri);
      throw new Error(`Failed to upload to YouTube: ${errorText}`);
    }
    
    const uploadData = await uploadRes.json();
    const videoId = uploadData.id;
    
    await supabase.from('youtube_upload_sessions').update({
      bytes_uploaded: fileSize,
      status: 'completed',
      video_id: videoId
    }).eq('session_uri', sessionUri);
    
    // 3. Poll status
    await this.getStatus(videoId, activeToken, post.id);
  }
  
  async getStatus(videoId: string, token: string, postId: string) {
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
        } else if (uploadStatus === 'rejected' || uploadStatus === 'failed') {
          throw new Error(`YouTube processing failed: ${status.rejectionReason || status.failureReason}`);
        }
      }
      
      // Wait 5 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    if (!isProcessed) {
       console.log(`[YouTubeAdapter] Video ${videoId} is still processing, continuing anyway to avoid timeout.`);
    } else {
       console.log(`[YouTubeAdapter] Video ${videoId} processed successfully.`);
    }
  }
}

// LinkedIn versions the REST API by YYYYMM and retires each after ~1 year; override via env if it goes stale.
const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION || '202606';

class LinkedInAdapter implements PlatformAdapter {
  async publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any) {
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
    } catch (e) {}

    let mediaUrn = null;

    // 1. Upload Media if present
    if (mediaUrl) {
      console.log(`[LinkedInAdapter] Uploading media for post ${post.id}...`);
      const mediaRes = await fetch(mediaUrl);
      if (!mediaRes.ok) throw new Error(`Failed to fetch media from ${mediaUrl}`);
      const mediaBuffer = await mediaRes.arrayBuffer();
      
      const isVideo = contentType === 'reel' || mediaUrl.match(/\.(mp4|mov|avi|mkv)(\?.*)?$/i);
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
         const uploadedPartIds: string[] = [];
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
      } else {
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
    const postBody: any = {
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
    
    console.log(`[LinkedInAdapter] Successfully published post ${post.id} to LinkedIn`);
  }
}

class TikTokAdapter implements PlatformAdapter {
  async publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any) {
    // TikTok publishing is not implemented (accounts are connected with mock tokens). Failing honestly lets the user see
    // a failure notification and a Failed status instead of a false "successfully published".
    throw new Error('TikTok publishing is not implemented yet.');
  }
}

// Trial-access Pinterest apps can only call the sandbox host; set PINTEREST_API_BASE=https://api-sandbox.pinterest.com to test there.
const PINTEREST_API_BASE = process.env.PINTEREST_API_BASE || 'https://api.pinterest.com';

// Trial-access apps get 401 in the sandbox with a normal OAuth token; the sandbox needs the token generated in the Pinterest developer portal.
const pinterestToken = (oauthToken: string) =>
  PINTEREST_API_BASE.includes('sandbox') && process.env.PINTEREST_SANDBOX_TOKEN ? process.env.PINTEREST_SANDBOX_TOKEN : oauthToken;

// post.media_url is a JSON map of platform -> URL (see ARCHITECTURE.md); fall back to a plain URL string.
function pinterestMediaUrl(post: any): string | null {
  try {
    const media = JSON.parse(post.media_url || '{}');
    return media.pinterest || null;
  } catch (e) {
    return post.media_url || null;
  }
}

class PinterestAdapter implements PlatformAdapter {
  async publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any) {
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
      if (!registerRes.ok) throw new Error(`Pinterest Media Registration Error: ${registerData.message || JSON.stringify(registerData)}`);

      const { media_id, upload_url, upload_parameters } = registerData;

      const videoUrl = pinterestMediaUrl(post);
      if (!videoUrl) throw new Error('No video URL provided for Pinterest Reel');

      const videoRes = await fetch(videoUrl);
      const videoBuffer = await videoRes.arrayBuffer();

      const formData = new FormData();
      for (const key in upload_parameters) {
        formData.append(key, upload_parameters[key]);
      }
      formData.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), 'video.mp4');

      const uploadRes = await fetch(upload_url, {
        method: 'POST',
        body: formData as any
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
      if (!pinRes.ok) throw new Error(`Pinterest Video Pin Error: ${pinData.message || JSON.stringify(pinData)}`);

      // Store the pin_id for analytics
      if (pinData.id) {
        await supabase.from('pinterest_published_pins').upsert({
          post_id: post.id,
          pin_id: pinData.id,
          user_id: post.user_id
        }, { onConflict: 'post_id' });
      }

    } else {
      const imageUrl = pinterestMediaUrl(post);
      if (!imageUrl) throw new Error('No image URL provided for Pinterest Pin');

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
      if (!pinRes.ok) throw new Error(`Pinterest Image Pin Error: ${pinData.message || JSON.stringify(pinData)}`);

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

class ThreadsAdapter implements PlatformAdapter {
  async publish(post: any, account: any, decryptedToken: string, contentType?: string, job?: any) {
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
    } catch (e) {}

    const body: any = { text: post.content, access_token: decryptedToken };
    
    if (mediaUrl) {
      const isVideo = contentType === 'reel' || mediaUrl.match(/\.(mp4|mov|avi|mkv)(\?.*)?$/i);
      if (isVideo) {
        body.media_type = 'VIDEO';
        body.video_url = mediaUrl;
      } else {
        body.media_type = 'IMAGE';
        body.image_url = mediaUrl;
      }
    } else {
      body.media_type = 'TEXT';
    }

    // 1. Create Container
    const containerRes = await fetch(`https://graph.threads.net/v1.0/me/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const containerData = await containerRes.json();
    if (containerData.error) throw new Error(containerData.error.message);

    // 2. Poll for status if media
    if (body.media_type !== 'TEXT') {
      let isReady = false;
      for (let i = 0; i < 24; i++) { // Poll up to 2 mins
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await fetch(`https://graph.threads.net/v1.0/${containerData.id}?fields=status,error_message&access_token=${decryptedToken}`);
        const statusData = await statusRes.json();
        if (statusData.status === 'FINISHED') {
          isReady = true;
          break;
        } else if (statusData.status === 'ERROR') {
          throw new Error(`Threads media container processing failed: ${statusData.error_message || 'Unknown error'}`);
        }
      }
      if (!isReady) {
        throw new Error('Threads media container timed out waiting for processing.');
      }
    }

    // 3. Publish
    const publishRes = await fetch(`https://graph.threads.net/v1.0/me/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerData.id, access_token: decryptedToken })
    });
    const publishData = await publishRes.json();
    if (publishData.error) throw new Error(publishData.error.message);
    
    console.log(`[ThreadsAdapter] Successfully published post ${post.id}`);
  }
}

const adapters: Record<string, PlatformAdapter> = {
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
  
  const { data: job, error: jobError } = await supabase.from('publish_jobs').select('*').eq('id', jobId).single();
  if (jobError || !job) return res.status(404).json({ error: 'Job not found' });

  // Rate Limiting Check
  if (publishRateLimiter) {
    const { success, limit, remaining, reset } = await publishRateLimiter.limit(`publish_${job.user_id}`);
    res.set('X-RateLimit-Limit', limit.toString());
    res.set('X-RateLimit-Remaining', remaining.toString());
    res.set('X-RateLimit-Reset', reset.toString());

    if (!success) {
      return res.status(429).json({ error: 'Too Many Requests. You can only publish 5 posts per minute.' });
    }
  }

  const { data: post, error: postError } = await supabase.from('posts').select('*').eq('id', job.post_id).single();
  if (postError || !post) return res.status(404).json({ error: 'Post not found' });

  const { data: account, error: accError } = await supabase.from('social_accounts')
    .select('*').eq('user_id', post.user_id).eq('platform', job.platform).single();
    
  if (accError || !account) return res.status(404).json({ error: `${job.platform} account not connected` });

  const adapter = adapters[job.platform];
  if (!adapter) return res.status(400).json({ error: `No adapter found for ${job.platform}` });

  try {
    const accessToken = decrypt(account.access_token_encrypted);
    await adapter.publish(post, account, accessToken, job.content_type, job);
    
    res.json({ success: true, message: `Published to ${job.platform}` });
  } catch (error: any) {
    console.error(error);
    if (error.message && error.message.includes('rate limit reached')) {
      return res.status(429).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to publish' });
  }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`Publishing Service listening on port ${PORT}`));
