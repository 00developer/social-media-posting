// Re-queues publish_jobs that are still 'scheduled' in Supabase but missing from BullMQ,
// exactly the way services/scheduling-service does it:
//   publishQueue.add('publish-post', { jobId, postId, userId, platform }, { delay, jobId })
// Usage: node requeue.js [--dry]
const root = require('path').resolve(__dirname, '..', '..') + '/'; // repo root
require(root + 'node_modules/dotenv').config({ path: root + '.env', override: true });
const { Queue } = require(root + 'node_modules/bullmq');
const Redis = require(root + 'node_modules/ioredis');
const { createClient } = require(root + 'node_modules/@supabase/supabase-js');
const dry = process.argv.includes('--dry');

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const url = process.env.REDIS_URL;
  const connection = new Redis(url, { maxRetriesPerRequest: null, ...((url.startsWith('rediss://') || url.includes('upstash')) && { tls: { rejectUnauthorized: false } }) });
  const queue = new Queue('publish-queue', { connection });
  console.log('redis host:', new URL(url).hostname, '| mode:', dry ? 'DRY RUN' : 'LIVE');

  const jobs = (await sb.from('publish_jobs').select('id, post_id, user_id, platform, status').eq('status', 'scheduled')).data;
  const schedules = (await sb.from('schedules').select('post_id, platform, scheduled_at, created_at')).data;

  for (const j of jobs) {
    const rows = schedules.filter((s) => s.post_id === j.post_id && s.platform === j.platform).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const s = rows[0];
    if (!s) { console.log(`SKIP ${j.id.slice(0, 8)} ${j.platform}: no schedule row`); continue; }
    const existing = await queue.getJob(j.id);
    if (existing) { console.log(`SKIP ${j.id.slice(0, 8)} ${j.platform}: already in the queue (${await existing.getState()})`); continue; }
    const runAt = new Date(s.scheduled_at).getTime();
    const delay = runAt - Date.now();
    if (delay < -5 * 60000) { console.log(`SKIP ${j.id.slice(0, 8)} ${j.platform}: scheduled_at is more than 5 min in the past`); continue; }
    if (dry) { console.log(`WOULD ADD ${j.id.slice(0, 8)} ${j.platform} delay=${delay}ms runs ${new Date(runAt).toISOString()}`); continue; }
    await queue.add('publish-post', { jobId: j.id, postId: j.post_id, userId: j.user_id, platform: j.platform }, { delay, jobId: j.id });
    console.log(`ADDED ${j.id.slice(0, 8)} ${j.platform} delay=${delay}ms runs ${new Date(runAt).toISOString()}`);
  }

  // verification
  console.log('\nqueue counts:', JSON.stringify(await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')));
  if (!dry) {
    for (const j of jobs) {
      const bj = await queue.getJob(j.id);
      const s = schedules.filter((x) => x.post_id === j.post_id && x.platform === j.platform).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      if (!bj) { console.log(`VERIFY FAIL ${j.id.slice(0, 8)}: not in queue`); continue; }
      const runsAt = bj.timestamp + bj.opts.delay;
      const payloadOk = JSON.stringify(bj.data) === JSON.stringify({ jobId: j.id, postId: j.post_id, userId: j.user_id, platform: j.platform });
      console.log(`VERIFY ${j.id.slice(0, 8)} ${j.platform.padEnd(9)} state=${await bj.getState()} idMatches=${bj.id === j.id} payloadOk=${payloadOk} attempts=${bj.opts.attempts || 1} runsAt-vs-scheduled_at=${runsAt - Date.parse(s.scheduled_at)}ms`);
    }
  }
  await queue.close(); await connection.quit();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
