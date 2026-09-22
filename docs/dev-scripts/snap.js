// Read-only snapshot of a post + its rows + its BullMQ jobs. Usage: node snap.js <postId> [outFile]
const root = require('path').resolve(__dirname, '..', '..') + '/'; // repo root
require(root + 'node_modules/dotenv').config({ path: root + '.env' });
const fs = require('fs');
const { createClient } = require(root + 'node_modules/@supabase/supabase-js');
const { Queue } = require(root + 'node_modules/bullmq');
const Redis = require(root + 'node_modules/ioredis');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const postId = process.argv[2];
const out = process.argv[3];

(async () => {
  const post = (await sb.from('posts').select('*').eq('id', postId).maybeSingle()).data;
  if (!post) { console.log('POST NOT FOUND:', postId); process.exit(2); }
  const schedules = (await sb.from('schedules').select('*').eq('post_id', postId).order('created_at')).data;
  const jobs = (await sb.from('publish_jobs').select('*').eq('post_id', postId).order('created_at')).data;
  const totals = {};
  for (const t of ['posts', 'schedules', 'publish_jobs']) totals[t] = (await sb.from(t).select('*', { count: 'exact', head: true })).count;

  const url = process.env.REDIS_URL;
  const conn = new Redis(url, { maxRetriesPerRequest: null, ...((url.startsWith('rediss://') || url.includes('upstash')) && { tls: { rejectUnauthorized: false } }) });
  const q = new Queue('publish-queue', { connection: conn });
  const queue = [];
  for (const j of jobs) {
    const bj = await q.getJob(j.id);
    queue.push(bj ? { id: bj.id, state: await bj.getState(), timestamp: bj.timestamp, delay: bj.opts.delay, runsAtMs: bj.timestamp + bj.opts.delay, data: bj.data } : { id: j.id, missing: true });
  }
  await q.close(); await conn.quit();

  const snap = { takenAt: new Date().toISOString(), post, schedules, jobs, queue, totals };
  if (out) fs.writeFileSync(out, JSON.stringify(snap, null, 2));
  console.log(JSON.stringify({
    post: { id: post.id, status: post.status, content: post.content, updated_at: post.updated_at, media_platforms: Object.keys(JSON.parse(post.media_url || '{}')) },
    schedules: schedules.map((s) => ({ id: s.id.slice(0, 8), platform: s.platform, scheduled_at: s.scheduled_at, updated_at: s.updated_at })),
    jobs: jobs.map((j) => ({ id: j.id.slice(0, 8), platform: j.platform, status: j.status, content_type: j.content_type, retry_count: j.retry_count, updated_at: j.updated_at })),
    queue: queue.map((x) => (x.missing ? x : { id: x.id.slice(0, 8), state: x.state, delay: x.delay, runsAt: new Date(x.runsAtMs).toISOString(), platform: x.data.platform })),
    totals,
  }, null, 2));
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
