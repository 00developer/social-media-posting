// Sends the same request the calendar's edit modal sends: PATCH /api/v1/posts/:id { userId, teamId, content }.
// Usage: node edit-caption.js <postId> <contentAsJsonString>
//   e.g. node edit-caption.js 85e737cb-0b8a-4688-a0f4-37b1b489bba1 "\"new text\\nline 2\""
// Looks the post's team and author up in Supabase (read-only) and calls post-service on :3002.
const root = require('path').resolve(__dirname, '..', '..') + '/';
require(root + 'node_modules/dotenv').config({ path: root + '.env', override: true });
const { createClient } = require(root + 'node_modules/@supabase/supabase-js');
const [postId, contentJson] = process.argv.slice(2);
if (!postId || contentJson === undefined) { console.log('usage: node edit-caption.js <postId> <contentAsJsonString>'); process.exit(2); }
const content = JSON.parse(contentJson);
(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: post } = await sb.from('posts').select('id, team_id, user_id').eq('id', postId).single();
  const res = await fetch(`http://localhost:3002/api/v1/posts/${postId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: post.user_id, teamId: post.team_id, content }),
  });
  const body = await res.json().catch(() => null);
  console.log('HTTP', res.status, JSON.stringify({ success: body && body.success, unchanged: body && body.unchanged, error: body && body.error, code: body && body.code }));
  process.exit(res.ok ? 0 : 1);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
