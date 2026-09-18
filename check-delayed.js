const { Queue } = require('bullmq');
const Redis = require('ioredis');
require('dotenv').config();

async function run() {
  const connection = new Redis(process.env.REDIS_URL, { tls: { rejectUnauthorized: false } });
  const publishQueue = new Queue('publish-queue', { connection });

  const delayedJobs = await publishQueue.getDelayed();
  for (const job of delayedJobs) {
    console.log(`Job ${job.id}: delayed until ${new Date(job.timestamp + job.delay).toISOString()}`);
    console.log('Data:', job.data);
  }
  
  process.exit(0);
}
run();
