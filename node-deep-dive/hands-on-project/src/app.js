import http from 'node:http';
import { URL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { runWithRequestContext, getRequestId } from './context.js';
import { publicError } from './errors.js';
import { snapshotMetrics } from './metrics.js';
import { streamOrderReport } from './streams/report.js';
import { chargePayment } from './services/payment-client.js';

async function readJson(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-request-id': getRequestId() ?? ''
  });
  res.end(payload);
}

function runWorker(n) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/cpu-worker.js', import.meta.url), {
      workerData: { n }
    });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
}

function block(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

export function createApp({ orderService, shutdown }) {
  const handler = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (req.method === 'GET' && url.pathname === '/health/live') {
        return sendJson(res, 200, { status: 'ok' });
      }

      if (req.method === 'GET' && url.pathname === '/health/ready') {
        return sendJson(res, 200, { status: 'ready', database: process.env.DB_MODE ?? 'memory', cache: process.env.CACHE_MODE ?? 'memory' });
      }

      if (req.method === 'GET' && url.pathname === '/metrics') {
        return sendJson(res, 200, snapshotMetrics());
      }

      if (req.method === 'GET' && url.pathname === '/debug/block') {
        block(Number(url.searchParams.get('ms') ?? 1000));
        return sendJson(res, 200, { blocked: true });
      }

      if (req.method === 'GET' && url.pathname === '/debug/cpu') {
        const n = Number(url.searchParams.get('n') ?? 50_000_000);
        const result = await runWorker(n);
        return sendJson(res, 200, { mode: 'worker', result });
      }

      if (req.method === 'GET' && url.pathname === '/debug/cpu-blocking') {
        const n = Number(url.searchParams.get('n') ?? 50_000_000);
        let result = 0;
        for (let i = 0; i < n; i += 1) result = (result + i) % 1_000_000_007;
        return sendJson(res, 200, { mode: 'main-thread', result });
      }

      if (req.method === 'GET' && url.pathname === '/debug/payment') {
        const delayMs = Number(url.searchParams.get('delay') ?? 0);
        const payment = await chargePayment({
          orderId: 'debug-order',
          amountCents: 1000,
          delayMs,
          timeoutMs: Number(process.env.PAYMENT_TIMEOUT_MS ?? 1000)
        });
        return sendJson(res, 200, payment);
      }

      if (req.method === 'GET' && url.pathname === '/reports/orders.csv') {
        const count = Math.min(1_000_000, Number(url.searchParams.get('count') ?? 100_000));
        return streamOrderReport(res, count);
      }

      if (req.method === 'POST' && url.pathname === '/orders') {
        const body = await readJson(req);
        const order = await orderService.create(body, req.headers['idempotency-key']);
        return sendJson(res, 201, order);
      }

      if (req.method === 'GET' && url.pathname.startsWith('/orders/')) {
        const id = url.pathname.split('/')[2];
        const result = await orderService.get(id);
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      const result = publicError(error);
      return sendJson(res, result.status, result.body);
    }
  };

  const server = http.createServer({ requestTimeout: 10_000, headersTimeout: 5_000, keepAliveTimeout: 5_000 }, runWithRequestContext(handler));

  server.on('clientError', (error, socket) => {
    console.error('client error', error.message);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.on('close', () => shutdown?.());

  return server;
}
