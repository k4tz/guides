import { monitorEventLoopDelay } from 'node:perf_hooks';

const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

export function snapshotMetrics() {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    eventLoopMeanMs: Number((Number(eventLoop.mean) / 1e6).toFixed(3)),
    eventLoopP99Ms: Number((Number(eventLoop.percentile(99)) / 1e6).toFixed(3))
  };
}
