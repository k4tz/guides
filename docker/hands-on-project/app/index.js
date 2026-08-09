const http = require('http');

const PORT = process.env.PORT || 3000;
const INSTANCE = process.env.INSTANCE_NAME || 'unknown';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', instance: INSTANCE }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Hello from Docker!',
    instance: INSTANCE,
    time: new Date().toISOString()
  }));
});

server.listen(PORT, () => {
  console.log(`Instance ${INSTANCE} listening on port ${PORT}`);
});
