import { Queue } from 'bullmq';
import Redis from 'ioredis';

export const PUBLISH_QUEUE_NAME = 'publish-queue';
export const NOTIFICATIONS_QUEUE_NAME = 'notifications-queue';

export function getRedisConnection(url: string) {
  const isTls = url.startsWith('rediss://') || url.includes('upstash');
  return new Redis(url, { 
    maxRetriesPerRequest: null,
    ...(isTls && { tls: { rejectUnauthorized: false } })
  });
}

export function getQueue(connection: Redis) {
  return new Queue(PUBLISH_QUEUE_NAME, { connection });
}

export function getNotificationsQueue(connection: Redis) {
  return new Queue(NOTIFICATIONS_QUEUE_NAME, { connection });
}

export * from './upstash';
export * from './cache';
export * from './ratelimit';
