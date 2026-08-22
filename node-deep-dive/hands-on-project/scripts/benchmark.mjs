import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

let bytes = 0;
const source = Readable.from((function* () {
  for (let i = 0; i < 100_000; i += 1) yield Buffer.alloc(1024, i % 255);
})());
const sink = new Writable({
  highWaterMark: 16 * 1024,
  write(chunk, encoding, callback) {
    bytes += chunk.length;
    setImmediate(callback);
  }
});

const start = performance.now();
await pipeline(source, sink);
console.log(JSON.stringify({ bytes, elapsedMs: Number((performance.now() - start).toFixed(2)) }));
