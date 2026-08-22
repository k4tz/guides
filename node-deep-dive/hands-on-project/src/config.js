export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbMode: process.env.DB_MODE ?? 'postgres',
  cacheMode: process.env.CACHE_MODE ?? 'redis',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://node:node@localhost:5432/orders',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 60),
  paymentTimeoutMs: Number(process.env.PAYMENT_TIMEOUT_MS ?? 1000)
};
