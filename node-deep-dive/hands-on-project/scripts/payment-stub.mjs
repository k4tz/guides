import http from 'node:http';

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/charge') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body || '{}');
    await new Promise(resolve => setTimeout(resolve, Number(input.delayMs ?? 0)));
    const response = JSON.stringify({ paymentId: `pay-${Date.now()}`, status: 'authorized', orderId: input.orderId });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(response) });
    return res.end(response);
  }
  res.writeHead(404);
  res.end();
});

server.listen(Number(process.env.PORT ?? 3100), () => console.log(`payment stub listening on http://localhost:${process.env.PORT ?? 3100}`));
