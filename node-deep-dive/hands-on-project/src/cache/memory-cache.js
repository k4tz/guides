export class MemoryCache {
  constructor() { this.values = new Map(); }
  async get(key) {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key, value, ttlSeconds) {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  async close() {}
}
