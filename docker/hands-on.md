# Docker — Hands-On Guide

A progressive, runnable exercise. Builds on `basic.md` and `advanced.md`. By the end you'll have:
**3 app server instances behind an nginx load balancer, all via Docker Compose.**

Prerequisite: Docker Desktop installed and running (see `basic.md` §1).

---

## Project structure

Create this structure anywhere on your machine:

```
hands-on/
├── app/
│   ├── index.js
│   ├── package.json
│   └── Dockerfile
├── nginx.conf
└── docker-compose.yml
```

---

## Step 1 — The toy app

`app/index.js`
```js
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
```

`app/package.json`
```json
{
  "name": "docker-hands-on-app",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  }
}
```

Notice it reads `INSTANCE_NAME` and `PORT` from environment variables and reports them back in the response — this is what lets us *prove* the load balancer is actually rotating across different containers later, and ties back to the env var section in `advanced.md`.

---

## Step 2 — Single container (sanity check)

`app/Dockerfile`
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

From inside `app/`:
```bash
docker build -t handsonapp .
docker run -d -p 3000:3000 --name test1 -e INSTANCE_NAME=test1 handsonapp
```

Check it:
```bash
curl http://localhost:3000/
```
Expect:
```json
{"message":"Hello from Docker!","instance":"test1","time":"..."}
```

Check logs and stop it:
```bash
docker logs test1
docker stop test1
docker rm test1
```

At this point you've exercised: `build`, `run -d -p -e --name`, `curl` against a mapped port, `logs`, `stop`, `rm`. This is the full basic lifecycle from `basic.md` §3–5.

---

## Step 3 — Two containers, same image, different names/ports

Prove an image can back multiple independent containers:
```bash
docker run -d -p 3001:3000 --name instanceA -e INSTANCE_NAME=A handsonapp
docker run -d -p 3002:3000 --name instanceB -e INSTANCE_NAME=B handsonapp

curl http://localhost:3001/
curl http://localhost:3002/
```
You'll see `"instance":"A"` and `"instance":"B"` respectively — same image, same code, different runtime identity purely via env vars.

Clean up before moving on:
```bash
docker rm -f instanceA instanceB
```

---

## Step 4 — Add nginx as a load balancer

`nginx.conf` (project root, next to `app/`)
```nginx
events {}

http {
    upstream app_servers {
        server app1:3000;
        server app2:3000;
        server app3:3000;
    }

    server {
        listen 80;

        location / {
            proxy_pass http://app_servers;
        }
    }
}
```

Note the `upstream` block references `app1`, `app2`, `app3` **by container name**, not IP — this works because Compose puts all services in the same project on a shared network with built-in DNS.

---

## Step 5 — Tie it together with Compose

`docker-compose.yml` (project root)
```yaml
version: "3.8"

services:
  app1:
    build: ./app
    environment:
      - INSTANCE_NAME=app1
      - PORT=3000
    networks:
      - appnet

  app2:
    build: ./app
    environment:
      - INSTANCE_NAME=app2
      - PORT=3000
    networks:
      - appnet

  app3:
    build: ./app
    environment:
      - INSTANCE_NAME=app3
      - PORT=3000
    networks:
      - appnet

  proxy:
    image: nginx:latest
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - app1
      - app2
      - app3
    networks:
      - appnet

networks:
  appnet:
    driver: bridge
```

**What's happening here:**
- Each `app*` service builds from the same `./app` Dockerfile but gets a different `INSTANCE_NAME` — same pattern as Step 3, just declared instead of typed manually.
- Only `proxy` publishes a host port (`8080:80`) — the app containers are reachable *only* from inside the `appnet` network, not directly from your machine. This mirrors a real setup where only the load balancer is internet-facing.
- `nginx.conf` is bind-mounted in read-only (`:ro`) rather than baked into a custom nginx image — fine for this exercise; a real production setup would likely build a custom nginx image instead.

---

## Step 6 — Run it

From the project root (where `docker-compose.yml` lives):
```bash
docker compose up -d --build
```

Check everything's up:
```bash
docker compose ps
```

Hit the load balancer repeatedly:
```bash
curl http://localhost:8080/
curl http://localhost:8080/
curl http://localhost:8080/
curl http://localhost:8080/
```

Watch the `"instance"` field rotate across `app1`, `app2`, `app3` — nginx's default round-robin is doing exactly what it says: distributing requests across your three containers, which are otherwise identical, isolated processes.

Check logs across all services at once:
```bash
docker compose logs -f
```

---

## Step 7 — Tear down

```bash
docker compose down
```
This stops and removes all four containers and the `appnet` network in one shot — the Compose equivalent of doing `docker rm -f` × 4 manually.

---

## What you just practiced

| Concept                              | Where                          |
|----------------------------------------|----------------------------------|
| Build image from Dockerfile             | Step 2                          |
| Run/stop/rm/logs lifecycle              | Step 2                          |
| One image → many containers             | Step 3                          |
| Env vars for per-container config       | Step 3, 5                       |
| Custom Docker network + name-based DNS  | Step 4, 5                       |
| nginx reverse proxy / load balancing    | Step 4                          |
| Compose orchestrating multi-container apps | Step 5–7                     |

This is the same mental model discussed in `basic.md` §2 — you've now actually run it, not just read about it.

---

## Next things to try on your own

- Scale without editing the compose file: `docker compose up -d --scale app1=0` and add a 4th replica manually to see nginx pick it up after an nginx reload.
- Add a `HEALTHCHECK` (see `advanced.md` §5) to the app Dockerfile and observe `docker compose ps` reporting health status.
- Swap nginx round-robin for `least_conn` in `nginx.conf` and compare behavior.
