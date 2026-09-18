const { Queue } = require('bullmq');
const Redis = require('ioredis');
require('dotenv').config();

async function run() {
  const connection = new Redis(process.env.REDIS_URL, { tls: { rejectUnauthorized: false } });
  const publishQueue = new Queue('publish-queue', { connection });

  const delayedJobs = await publishQueue.getDelayed();
  for (const job of delayedJobs) {
    console.log(`Promoting Job ${job.id}`);
    await job.promote();
  }
  
  console.log('Done promoting jobs.');
  process.exit(0);
}
run();
