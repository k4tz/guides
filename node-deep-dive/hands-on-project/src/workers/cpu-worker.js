import { parentPort, workerData } from 'node:worker_threads';
let total = 0;
for (let i = 0; i < workerData.n; i += 1) total = (total + i) % 1_000_000_007;
parentPort.postMessage(total);
