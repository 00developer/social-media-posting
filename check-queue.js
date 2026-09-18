const { Queue } = require('bullmq');
const Redis = require('ioredis');
require('dotenv').config();

async function run() {
  const connection = new Redis(process.env.REDIS_URL, { tls: { rejectUnauthorized: false } });
  const publishQueue = new Queue('publish-queue', { connection });

  const waiting = await publishQueue.getWaitingCount();
  const active = await publishQueue.getActiveCount();
  const delayed = await publishQueue.getDelayedCount();
  const failed = await publishQueue.getFailedCount();

  console.log(`Waiting: ${waiting}`);
  console.log(`Active: ${active}`);
  console.log(`Delayed: ${delayed}`);
  console.log(`Failed: ${failed}`);

  const activeJobs = await publishQueue.getActive();
  if (activeJobs.length > 0) {
    console.log('Active job IDs:', activeJobs.map(j => j.id));
  }
  
  process.exit(0);
}

run();
