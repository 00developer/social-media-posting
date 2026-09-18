const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
require('dotenv').config({ path: 'c:/Users/o/Desktop/Antigravity/social-posting/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';

function decrypt(text) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

async function getFacebookPages(decryptedToken) {
  let pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${decryptedToken}`);
  let pagesData = await pagesRes.json();
  if (pagesData.data && pagesData.data.length > 0) return pagesData.data;
  
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return [];
  
  const debugRes = await fetch(`https://graph.facebook.com/v18.0/debug_token?input_token=${decryptedToken}&access_token=${appId}|${appSecret}`);
  const debugData = await debugRes.json();
  
  const targetIds = new Set();
  if (debugData.data?.granular_scopes) {
    for (const scope of debugData.data.granular_scopes) {
      if (scope.target_ids) scope.target_ids.forEach(id => targetIds.add(id));
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

async function run() {
  const { data: accounts } = await supabase.from('social_accounts').select('*').eq('platform', 'facebook');
  if (!accounts || accounts.length === 0) return console.log('No FB accounts');
  
  const account = accounts[0];
  const userToken = decrypt(account.access_token_encrypted);
  
  const pages = await getFacebookPages(userToken);
  const page = pages[0];
  
  if (!page) return console.log('No Pages found');
  
  const pageToken = page.access_token;
  const pageId = page.id;
  console.log('Got page token for', pageId);
  
  const mediaUrl = "https://drgqkqjhjrsylnhoopqz.supabase.co/storage/v1/object/public/post_media/47852654-b6fa-4e8d-ab40-f0b04361b9fc/df54003e-58d0-40d9-90c5-5015b2e5f976/facebook.mp4";
  
  // Start Phase
  let res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: pageToken })
  });
  let data = await res.json();
  console.log('Start Phase:', data);
  if (data.error) return;
  
  const videoId = data.video_id;
  const uploadUrl = data.upload_url;
  
  const mediaRes = await fetch(mediaUrl);
  const mediaBuffer = await mediaRes.arrayBuffer();
  console.log('Media size:', mediaBuffer.byteLength);
  
  // Upload Phase
  res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 
      'Authorization': `OAuth ${pageToken}`,
      'offset': '0',
      'file_size': mediaBuffer.byteLength.toString(),
      'Content-Type': 'application/octet-stream' // testing this
    },
    body: Buffer.from(mediaBuffer)
  });
  data = await res.text();
  console.log('Upload Phase Text:', data);
  try { data = JSON.parse(data); } catch(e){}
  
  // Finish Phase
  res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      upload_phase: 'finish', 
      video_id: videoId, 
      video_state: 'PUBLISHED',
      description: 'Test Reel',
      access_token: pageToken 
    })
  });
  data = await res.json();
  console.log('Finish Phase:', data);
}
run();
