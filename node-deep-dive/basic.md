# Node.js Deep Dive — Basics

This guide treats Node.js as a **runtime and concurrency model**, not just a way to write HTTP APIs.

The goal is to understand what happens underneath a typical backend request and why certain Node.js patterns work well—or fail badly—under load.

> Examples use **plain JavaScript** and target modern Node.js 22+. The hands-on project uses JavaScript, PostgreSQL, Redis, and Docker Compose for the intended environment; the included verification fallback runs without external services when Docker is unavailable.

---

## 1. Why Node.js exists

A conventional server can give every request a dedicated thread. That model is straightforward, but thousands of mostly-waiting threads consume memory and create scheduling overhead.

Node.js takes a different approach:

```text
HTTP request
    ↓
JavaScript runs briefly
    ↓
Start I/O (DB / network / filesystem)
    ↓
JavaScript yields
    ↓
OS / libuv handles waiting
    ↓
I/O completes
    ↓
Callback / Promise continuation becomes runnable
    ↓
Event loop runs JavaScript again
    ↓
HTTP response
```

The important mental model is **not** “Node is single-threaded.” The JavaScript execution context is primarily single-threaded, while Node and its underlying libraries use the operating system and libuv for asynchronous I/O. Node can therefore keep many I/O operations in flight without allocating one JavaScript thread per connection.

The consequence is equally important: **one piece of long-running JavaScript can block every request handled by that process.**

---

## 2. Installation and a first runtime check

Install a current LTS Node.js release, then verify:

```bash
node --version
npm --version
```

Run JavaScript directly:

```bash
node -e "console.log(process.version)"
```

Create a project:

```bash
mkdir node-deep-dive-demo
cd node-deep-dive-demo
npm init -y
```

For the examples in this guide, either use `.mjs` files or add this to `package.json`:

```json
{
  "type": "module"
}
```

Modern Node supports both CommonJS and ECMAScript modules. Being explicit about the package type avoids ambiguity.

---

# 3. The event loop: the core mental model

The event loop is the mechanism that lets a Node process repeatedly take ready work and execute JavaScript callbacks.

A simplified picture is:

```text
┌───────────────────────────────┐
│       JavaScript stack        │
└───────────────┬───────────────┘
                ↓
        asynchronous I/O
                ↓
┌───────────────────────────────┐
│            libuv              │
│ timers / poll / check / etc.  │
└───────────────┬───────────────┘
                ↓
        ready callback
                ↓
       microtask checkpoints
                ↓
         next JS callback
```

The exact implementation is more nuanced than this diagram. For application development, the useful distinction is:

- **Call stack:** JavaScript currently executing.
- **Event-loop phases:** places where Node processes different categories of callbacks.
- **Microtasks:** Promise continuations and `queueMicrotask()` callbacks that run with higher priority than ordinary phase callbacks.
- **`process.nextTick()` queue:** Node-specific callbacks processed before the event loop continues.

### Runnable example

Create `event-loop-order.mjs`:

```js
import fs from 'node:fs';

console.log('A: synchronous');

setTimeout(() => console.log('B: timer'), 0);

setImmediate(() => console.log('C: immediate'));

Promise.resolve().then(() => console.log('D: promise'));

queueMicrotask(() => console.log('E: microtask'));

process.nextTick(() => console.log('F: nextTick'));

fs.readFile(new URL(import.meta.url), () => {
  console.log('G: I/O callback');
});

console.log('H: synchronous');
```

Run it:

```bash
node event-loop-order.mjs
```

The important lesson is not to memorize one universal order for every context. In particular, `setTimeout(0)` versus `setImmediate()` can vary depending on where they are scheduled. Also, the relative order of `process.nextTick()` and microtasks differs between CommonJS and ESM: in CommonJS, `nextTick` runs before Promise/`queueMicrotask()` callbacks; ESM module evaluation itself is already part of the microtask machinery, so the example above can show Promise/microtask callbacks before `nextTick`. Treat `nextTick` as a Node-specific compatibility primitive, not your default scheduling API. Modern Node documentation marks it Legacy and recommends `queueMicrotask()` for most userland deferral.

---

## 4. Call stack

JavaScript executes one stack frame at a time.

```js
function third() {
  console.trace('third');
}

function second() {
  third();
}

function first() {
  second();
}

first();
```

The stack looks conceptually like:

```text
third()
second()
first()
<module>
```

If a function never yields, the stack cannot move on to other JavaScript work.

### The classic mistake

```js
function blockFor(seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {}
}

blockFor(5);
```

While this loop runs, an ordinary Node process cannot execute another JavaScript callback on that thread. This is why CPU-heavy synchronous work is dangerous inside request handlers.

---

# 5. Event-loop phases

At a high level, Node's loop contains phases associated with:

```text
timers
  ↓
pending callbacks
  ↓
idle / prepare (internal)
  ↓
poll (I/O)
  ↓
check (`setImmediate`)
  ↓
close callbacks
  ↺
```

Node may perform microtask checkpoints between callbacks/phases as part of running JavaScript. `process.nextTick()` has special priority within Node's scheduling model.

You should understand the phases well enough to answer questions such as:

- Why did this callback run later than expected?
- Why does `setImmediate()` often win over a timer when scheduled from an I/O callback?
- Why can a huge Promise chain starve ordinary callbacks?

---

# 6. Microtasks vs macrotask-style work

In browser terminology you will often hear “macrotask.” Node's documentation generally talks about event-loop phases rather than treating the entire phase system as one browser-style macrotask queue.

For practical Node work, distinguish:

```text
Higher-priority continuation work
├── process.nextTick()
├── queueMicrotask()
└── Promise reactions

Event-loop phase work
├── timers
├── I/O callbacks
├── check / setImmediate
└── close callbacks
```

### Promise and queueMicrotask

```js
console.log('1');

Promise.resolve().then(() => console.log('2: promise'));
queueMicrotask(() => console.log('3: queueMicrotask'));

console.log('4');
```

The synchronous logs happen first. The Promise reaction and microtask run after the current synchronous turn.

### `process.nextTick()`

```js
console.log('1');

process.nextTick(() => console.log('2: nextTick'));
queueMicrotask(() => console.log('3: microtask'));
Promise.resolve().then(() => console.log('4: promise'));

console.log('5');
```

In CommonJS, `nextTick` has special treatment and is processed before the regular microtask queue. ESM has a notable ordering difference because module evaluation itself runs as microtask work. This is useful for understanding Node internals, but overusing `nextTick` can prevent the event loop from making progress. For ordinary userland deferral, prefer `queueMicrotask()` unless you specifically need `nextTick` semantics.

A pathological example:

```js
let count = 0;

function starve() {
  count += 1;
  if (count < 100000) process.nextTick(starve);
}

starve();
setTimeout(() => console.log('timer finally runs'), 0);
```

The lesson is **yielding is part of concurrency design**.

---

# 7. Timers, I/O callbacks, and `setImmediate()`

### Timer

```js
setTimeout(() => {
  console.log('timer callback');
}, 10);
```

The delay is a minimum scheduling threshold, not a promise that the callback executes exactly at that time.

### Immediate

```js
setImmediate(() => {
  console.log('check phase');
});
```

### I/O callback

```js
import fs from 'node:fs';

fs.readFile('package.json', () => {
  console.log('I/O callback');
  setImmediate(() => console.log('immediate from I/O'));
  setTimeout(() => console.log('timer from I/O'), 0);
});
```

When `setImmediate()` and a zero-delay timer are scheduled **inside an I/O callback**, `setImmediate()` is generally observed first because the loop is moving toward the check phase after poll. Outside an I/O callback, don't rely on a fixed ordering between them.

---

# 8. Why Node handles many concurrent connections

Suppose 1,000 requests each spend 95% of their lifetime waiting on a database or external API.

A thread-per-request model can spend a lot of resources representing waiting threads.

Node instead aims for:

```text
Request A → DB wait ────────────────→ response
Request B → external API wait ──────→ response
Request C → DB wait ────────────────→ response
                 ↑
        JavaScript is free to
        process other requests
```

This works extremely well for **I/O-heavy workloads**.

It does not make CPU-heavy JavaScript magically parallel. A CPU-bound loop still occupies the JavaScript thread.

---

# 9. Streams: moving data without loading everything

Streams represent data that can be consumed or produced incrementally.

The core types are:

```text
Readable → data source
Writable → data destination
Transform → read + transform + write
Duplex → independent readable + writable sides
```

### Readable

```js
import { Readable } from 'node:stream';

const source = Readable.from(['one\n', 'two\n', 'three\n']);

for await (const chunk of source) {
  process.stdout.write(chunk);
}
```

### Writable

```js
import { Writable } from 'node:stream';

const sink = new Writable({
  write(chunk, encoding, callback) {
    console.log('received:', chunk.toString());
    callback();
  }
});

sink.write('hello');
sink.end('world');
```

### Transform

```js
import { Transform } from 'node:stream';

const upper = new Transform({
  transform(chunk, encoding, callback) {
    callback(null, chunk.toString().toUpperCase());
  }
});

upper.on('data', chunk => console.log(chunk.toString()));
upper.write('hello');
upper.end('world');
```

---

# 10. `pipe()` and backpressure

The dangerous implementation is:

```js
for (const chunk of hugeDataSource) {
  destination.write(chunk);
}
```

If the destination is slower than the source, buffered data can grow.

`pipe()` connects streams while coordinating flow:

```js
import fs from 'node:fs';

fs.createReadStream('large-file.bin')
  .pipe(fs.createWriteStream('copy.bin'));
```

For modern code, `pipeline()` is often preferable because it also propagates errors and completion correctly:

```js
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

await pipeline(
  fs.createReadStream('large-file.bin'),
  fs.createWriteStream('copy.bin')
);
```

### `highWaterMark`

A stream's `highWaterMark` is a buffering threshold. It is **not a hard global memory limit**.

```js
import { Writable } from 'node:stream';

const slowSink = new Writable({
  highWaterMark: 1024,
  write(chunk, encoding, callback) {
    setTimeout(callback, 20);
  }
});

const ok = slowSink.write(Buffer.alloc(1024));
console.log({ ok, highWaterMark: slowSink.writableHighWaterMark });
```

When `write()` returns `false`, producers should stop writing until `'drain'` fires.

The important relationship is:

```text
Fast producer → buffer → slow consumer
                     ↑
             backpressure
```

Without backpressure, the buffer can grow until memory pressure and garbage collection become severe.

---

# 11. Streaming large HTTP responses

Avoid:

```js
const file = await fs.promises.readFile('huge.zip');
res.end(file);
```

for very large objects when you don't need the entire object in memory.

Prefer:

```js
import fs from 'node:fs';

const stream = fs.createReadStream('huge.zip');
stream.pipe(res);
```

A stream lets the response progress incrementally and naturally coordinates with the destination's ability to consume data.

---

# 12. Concurrency vs parallelism

These are different.

**Concurrency:** multiple operations are in progress and their waiting periods overlap.

**Parallelism:** multiple computations execute simultaneously.

Node's event loop gives you concurrency for I/O-heavy work:

```text
JS thread
├── request A starts DB I/O → waiting
├── request B starts HTTP I/O → waiting
├── request C executes callback
└── request A resumes when DB completes
```

Worker threads provide actual parallel JavaScript execution:

```text
Main thread ──────┬──── Worker 1
                  ├──── Worker 2
                  └──── Worker 3
```

---

# 13. Worker threads

Workers are designed for CPU-intensive JavaScript. They are usually not the answer to ordinary I/O work; Node's asynchronous I/O is already designed for that.

### Runnable worker

`worker-demo.mjs`:

```js
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (!isMainThread) {
  let total = 0;
  for (let i = 0; i < workerData.n; i++) total += i;
  parentPort.postMessage(total);
} else {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { n: 100_000_000 }
  });

  worker.on('message', result => console.log('result:', result));
  worker.on('error', console.error);
}
```

Workers can transfer `ArrayBuffer` instances and share memory using `SharedArrayBuffer`.

### Shared memory

```js
const shared = new SharedArrayBuffer(4);
const view = new Int32Array(shared);

Atomics.add(view, 0, 1);
console.log(Atomics.load(view, 0));
```

Shared memory introduces synchronization problems that ordinary message passing avoids. Use it only when its performance characteristics justify the complexity.

---

# 14. Worker vs child process vs queue vs microservice

Use a **worker thread** when:

- the work is CPU-heavy JavaScript,
- you want to stay inside the Node process model,
- you need efficient memory transfer/shared memory.

Use a **child process** when:

- you need process isolation,
- you need to run an external executable,
- failure isolation matters more than low-overhead communication.

Use a **queue** when:

- the work can happen asynchronously,
- you need retries,
- you need durability,
- work may outlive the HTTP request.

Use a **microservice** when:

- the capability needs independent deployment/scaling/ownership,
- isolation and organizational boundaries justify the network boundary.

Do not use worker threads simply because “Node is single-threaded.”

---

# 15. Node.js memory and V8

A useful simplified model is:

```text
Node process
├── V8 heap
│   ├── objects
│   ├── closures
│   └── arrays
├── native / external memory
│   ├── Buffers
│   └── native resources
└── OS resources
    ├── sockets
    ├── file descriptors
    └── threads
```

The JavaScript stack holds active execution frames. The heap holds dynamically allocated JavaScript objects.

### Observe memory

```js
console.log(process.memoryUsage());
```

Important fields include:

- `heapUsed`
- `heapTotal`
- `external`
- `arrayBuffers`
- `rss`

A rising RSS does not automatically mean “the V8 heap is leaking.” Native buffers, sockets, and other resources matter too.

---

# 16. Garbage collection

JavaScript objects that are no longer reachable can eventually be reclaimed.

A simple retention bug:

```js
const cache = new Map();

setInterval(() => {
  cache.set(Date.now(), Buffer.alloc(1024 * 1024));
}, 100);
```

Nothing removes old entries, so memory keeps growing.

Common leak sources include:

- unbounded Maps/Sets,
- global arrays,
- event listeners that are never removed,
- timers that retain objects,
- caches without eviction,
- open sockets/resources,
- closures retaining large object graphs.

---

# 17. Diagnosing performance problems

Do not start by changing random code. Measure first.

A slow API might be:

```text
HTTP parsing       2 ms
middleware         5 ms
business logic    10 ms
PostgreSQL       120 ms  ← bottleneck
Redis              2 ms
external API      200 ms  ← bottleneck
serialization      8 ms
--------------------------------
                    347 ms
```

Measure the boundaries rather than guessing.

### Event-loop delay

```js
import { monitorEventLoopDelay } from 'node:perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

setInterval(() => {
  console.log({
    meanMs: Number(histogram.mean) / 1e6,
    p99Ms: Number(histogram.percentile(99)) / 1e6
  });
}, 1000);
```

### CPU profile

Node can generate CPU profiles that can be opened with Chrome DevTools:

```bash
node --cpu-prof app.mjs
```

For heap investigation, Node also provides heap-snapshot tooling:

```bash
node --heapsnapshot-signal=SIGUSR2 app.mjs
```

Use production-safe controls and understand that heap snapshots pause execution and can temporarily require substantial memory.

---

# 18. HTTP internals

An incoming request can be simplified as:

```text
Client
  ↓ DNS
TCP connection
  ↓ TLS for HTTPS
HTTP parser
  ↓
Node HTTP server
  ↓
request handler / framework middleware
  ↓
business logic
  ↓
DB / Redis / external APIs
  ↓
HTTP response
  ↓
TCP socket
```

The application doesn't normally interact directly with TCP packets. Node's HTTP layer and operating system networking stack do that work.

---

## HTTP/1.1 vs HTTP/2

### HTTP/1.1

- Requests/responses use the HTTP/1.1 protocol.
- Connections can be reused with keep-alive.
- Multiple requests can use a connection, but HTTP/1.1 does not provide HTTP/2-style multiplexed streams.

### HTTP/2

- Binary framing.
- Multiplexed streams over a single connection.
- Header compression.
- Stream-level prioritization mechanisms.

The application-level trade-off is not “HTTP/2 is always faster.” Network characteristics, proxies, TLS, server behavior, request sizes, and workload shape all matter.

A minimal HTTP/2 server: 

```js
import http2 from 'node:http2';

const server = http2.createServer();
server.on('stream', (stream, headers) => {
  stream.respond({ ':status': 200, 'content-type': 'text/plain' });
  stream.end(`path=${headers[':path']}`);
});
server.listen(8443);
```

---

# 19. Keep-alive and connection pooling

Opening a new TCP/TLS connection for every outgoing request is expensive.

Connection reuse looks like:

```text
Request 1 ──┐
Request 2 ──┼── pooled TCP/TLS connection
Request 3 ──┘
```

Node's HTTP client has connection-management facilities, and modern Node versions also provide the standards-based `fetch()` API backed by Undici.

Always consider:

- connection reuse,
- maximum concurrent connections,
- idle timeout,
- request timeout,
- connection establishment cost,
- failure/retry behavior.

---

# 20. `fetch()` and Undici

Modern Node includes `fetch()`:

```js
const response = await fetch('https://example.com');
const body = await response.text();
console.log(response.status, body.length);
```

Use an `AbortController` for request cancellation:

```js
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 2_000);

try {
  const response = await fetch('https://example.com', {
    signal: controller.signal
  });
  console.log(response.status);
} finally {
  clearTimeout(timer);
}
```

A timeout is not just a performance setting. It is a **resource-protection mechanism**: without one, an external dependency can hold resources indefinitely.

---

# 21. Stateless services and horizontal scaling

A stateless API can route requests to any instance:

```text
                 ┌── Node instance A
Load balancer ───┼── Node instance B
                 └── Node instance C
```

Avoid storing request-critical state only in process memory if another instance must be able to handle the next request.

Use shared infrastructure such as:

- PostgreSQL,
- Redis,
- object storage,
- durable queues.

For example, this is process-local state and therefore does not follow a request when a load balancer sends the next request to another instance:

```js
const sessions = new Map();
sessions.set('user-1', { loggedIn: true });
```

For horizontally scaled services, store state that must survive instance changes in a shared system instead.

This is why Redis sessions/caches and externalized state become important as you scale horizontally.

---

# 22. `cluster`, PM2, and containers

Node's `cluster` module can create multiple Node processes that share a server port. This is process-level parallelism, not multiple JavaScript threads inside one process.

A conceptual setup is:

```text
                 port 3000
                    ↓
              cluster primary
             /       |       \
        worker 1  worker 2  worker 3
```

In modern production environments, you may instead run one process per container and let an orchestrator such as ECS/Kubernetes provide horizontal scaling.

A minimal cluster example: 

```js
import cluster from 'node:cluster';
import os from 'node:os';
import http from 'node:http';

if (cluster.isPrimary) {
  for (let i = 0; i < Math.min(2, os.availableParallelism()); i += 1) cluster.fork();
} else {
  http.createServer((req, res) => res.end(`worker ${process.pid}`)).listen(3000);
}
```

PM2 can manage multiple Node processes, restarts, logs, and deployments. It is useful in some VPS environments, but an orchestrator may already provide the process-management responsibilities you need.

For example, a simple PM2 start command is:

```bash
npm install -g pm2
pm2 start src/server.js --name order-api
pm2 status
```

---

# 23. Graceful shutdown

A production process should stop accepting new work and finish or cancel in-flight work before exiting.

```js
const server = app.listen(3000);

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);

  server.close(async () => {
    await closeDatabasePool();
    await closeRedisClient();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

In a real service, also:

- stop accepting new queue work,
- finish or requeue active jobs,
- close outbound clients,
- close database pools,
- stop WebSocket acceptance,
- enforce a shutdown deadline.

---

# 24. What you can do now

After this chapter, you should be able to explain:

- why Node handles I/O concurrency well,
- why CPU-bound JavaScript is dangerous,
- how event-loop phases differ from microtasks,
- what `nextTick`, Promises, timers, and `setImmediate` are doing,
- why streams and backpressure matter,
- when workers are appropriate,
- how HTTP connections are reused,
- why connection pools matter,
- what statelessness means for horizontal scaling,
- why graceful shutdown is part of application correctness.

Continue with **[advanced.md](advanced.md)** for production failure modes, security, observability, and the pre-launch checklist.
