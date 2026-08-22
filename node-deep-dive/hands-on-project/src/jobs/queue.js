export class InMemoryJobQueue {
  constructor() { this.jobs = []; this.running = false; }
  enqueue(job) { this.jobs.push(job); void this.drain(); }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift();
        try { await job(); } catch (error) { console.error('background job failed', error); }
      }
    } finally { this.running = false; }
  }
}
