const root = require('path').resolve(__dirname, '..', '..') + '/'; // repo root
require(root + 'node_modules/dotenv').config({ path: root + '.env', override: true });
const Redis = require(root + 'node_modules/ioredis');
const { Queue } = require(root + 'node_modules/bullmq');
const { createClient } = require(root + 'node_modules/@supabase/supabase-js');

(async () => {
  console.log('host in use:', new URL(process.env.REDIS_URL).hostname);

  // 1) TCP/TLS via ioredis (what BullMQ and the shared package use)
  const conn = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, tls: { rejectUnauthorized: false } });
  const pong = await conn.ping();
  console.log('1) ioredis PING (TLS):', pong);

  // 2) Upstash REST (role cache, feed cache, rate limiter, analytics counters)
  const rest = await fetch(process.env.UPSTASH_REDIS_REST_URL + '/ping', { headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN } });
  console.log('2) Upstash REST /ping:', rest.status, JSON.stringify(await rest.json()));
  const set = await fetch(process.env.UPSTASH_REDIS_REST_URL + '/set/__s33_probe/ok/EX/30', { headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN } });
  const get = await fetch(process.env.UPSTASH_REDIS_REST_URL + '/get/__s33_probe', { headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN } });
  console.log('   REST set/get round-trip:', JSON.stringify(await set.json()), JSON.stringify(await get.json()), '(key expires in 30 s)');

  // 3) BullMQ on the new database
  const q = new Queue('publish-queue', { connection: conn });
  console.log('3) publish-queue counts on the NEW db:', JSON.stringify(await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')));
  console.log('   total keys in new db:', await conn.dbsize());
  await q.close(); await conn.quit();

  // 4) What the swap cost: publish_jobs still 'scheduled' in Supabase but no longer in any queue
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const jobs = (await sb.from('publish_jobs').select('id, post_id, platform, status').eq('status', 'scheduled')).data;
  console.log(`4) publish_jobs with status 'scheduled' in Supabase: ${jobs.length} -> queued in the new Redis: 0  (these will NOT fire unless re-queued)`);
  const sch = (await sb.from('schedules').select('post_id, platform, scheduled_at')).data;
  for (const j of jobs) {
    const s = sch.find((x) => x.post_id === j.post_id && x.platform === j.platform);
    console.log(`   - job ${j.id.slice(0, 8)} ${j.platform.padEnd(9)} post ${j.post_id.slice(0, 8)} scheduled_at ${s ? s.scheduled_at : '?'}`);
  }
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
