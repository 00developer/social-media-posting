import dns from 'dns';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

// Force Node.js to resolve IPv4 addresses first.
// Prevents ENOTFOUND / ETIMEDOUT when resolving Redis Cloud hostnames on networks where IPv6 / NAT64 drops.
try {
  dns.setDefaultResultOrder?.('ipv4first');
} catch {
  // Ignored if not supported in the running Node runtime
}

export const PUBLISH_QUEUE_NAME = 'publish-queue';
export const NOTIFICATIONS_QUEUE_NAME = 'notifications-queue';

export function getRedisConnection(url: string) {
  const isTls = url.startsWith('rediss://') || url.includes('upstash');
  const redis = new Redis(url, { 
    maxRetriesPerRequest: null,
    connectTimeout: 15000,
    enableReadyCheck: false,
    retryStrategy(times) {
      // Reconnect with exponential backoff up to 3s to stay alive across Wi-Fi or DNS hiccups
      const delay = Math.min(times * 150, 3000);
      return delay;
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'];
      return targetErrors.some(target => (err.message || '').includes(target));
    },
    ...(isTls && { tls: { rejectUnauthorized: false } })
  });

  redis.on('error', (err: any) => {
    // Avoid noisy uncaught crashes on transient network drops while ioredis reconnects in background
    const code = err?.code || '';
    const msg = err?.message || '';
    if (code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || msg.includes('ENOTFOUND')) {
      return;
    }
    console.error('[Redis Client Error]', msg || err);
  });

  return redis;
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
export * from './auth';
export * from './secrets';

