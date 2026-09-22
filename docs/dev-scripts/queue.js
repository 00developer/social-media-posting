// Read-only BullMQ inspection of publish-queue
const root = require('path').resolve(__dirname, '..', '..') + '/'; // repo root
require(root + 'node_modules/dotenv').config({ path: root + '.env' });
const { Queue } = require(root + 'node_modules/bullmq');
const Redis = require(root + 'node_modules/ioredis');
const ist = (ms) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
(async () => {
  const url = process.env.REDIS_URL;
  const tls = url.startsWith('rediss://') || url.includes('upstash');
  const connection = new Redis(url, { maxRetriesPerRequest: null, ...(tls && { tls: { rejectUnauthorized: false } }) });
  const q = new Queue('publish-queue', { connection });
  const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
  console.log('publish-queue counts:', JSON.stringify(counts));
  for (const state of ['delayed', 'waiting', 'active', 'failed']) {
    const jobs = await q.getJobs([state], 0, 20);
    for (const j of jobs) {
      const st = await j.getState();
      console.log(`[${state}] bullmq id=${j.id} state=${st} runsAt=${ist(j.timestamp + (j.opts.delay || 0))} delay=${j.opts.delay} attempts=${j.opts.attempts || 1} data=${JSON.stringify(j.data)}`);
    }
  }
  const completed = await q.getJobs(['completed'], 0, 5);
  for (const j of completed) console.log(`[completed] id=${j.id} platform=${j.data.platform} finished=${j.finishedOn ? ist(j.finishedOn) : '-'}`);
  await q.close(); await connection.quit();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
