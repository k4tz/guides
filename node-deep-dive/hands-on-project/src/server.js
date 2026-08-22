import http from 'node:http';
import { config } from './config.js';
import { MemoryOrderRepository } from './repositories/memory-order-repository.js';
import { PostgresOrderRepository } from './repositories/postgres-order-repository.js';
import { MemoryCache } from './cache/memory-cache.js';
import { RedisCache } from './cache/redis-cache.js';
import { InMemoryJobQueue } from './jobs/queue.js';
import { OrderService } from './services/order-service.js';
import { createApp } from './app.js';

let pool;
let cache;

async function buildDependencies() {
  const repository = config.dbMode === 'postgres'
    ? await createPostgresRepository()
    : new MemoryOrderRepository();

  cache = config.cacheMode === 'redis'
    ? await createRedisCache()
    : new MemoryCache();

  return { repository, cache, queue: new InMemoryJobQueue() };
}

async function createPostgresRepository() {
  const { Pool } = await import('pg');
  pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 2_000 });
  await pool.query('SELECT 1');
  return new PostgresOrderRepository(pool);
}

async function createRedisCache() {
  const { createClient } = await import('redis');
  const client = createClient({ url: config.redisUrl });
  client.on('error', error => console.error('redis error', error));
  await client.connect();
  return new RedisCache(client);
}

const dependencies = await buildDependencies();
const orderService = new OrderService({ ...dependencies, cacheTtlSeconds: config.cacheTtlSeconds });
const server = createApp({
  orderService,
  shutdown: async () => {
    await cache?.close?.();
    await pool?.end?.();
  }
});

server.listen(config.port, () => {
  console.log(`Order service listening on http://localhost:${config.port}`);
  console.log(`mode=${config.dbMode}/${config.cacheMode}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: graceful shutdown`);
  server.close(async () => {
    await cache?.close?.();
    await pool?.end?.();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', error => {
  console.error('uncaughtException', error);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', error => {
  console.error('unhandledRejection', error);
  shutdown('unhandledRejection');
});
