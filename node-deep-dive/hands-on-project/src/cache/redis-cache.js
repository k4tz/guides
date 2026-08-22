export class RedisCache {
  constructor(client) { this.client = client; }
  async get(key) {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }
  async set(key, value, ttlSeconds) {
    await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }
  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}
