# Docker — Best Practices & Production-Ready Guide

Builds on `basic.md`. This covers what changes when you go from "it runs" to "it's production-sane."

---

## 1. Layer Caching — Why Instruction Order Matters

Docker builds an image as a stack of **layers**, one per Dockerfile instruction, and caches each layer. On a rebuild, Docker walks the Dockerfile top to bottom and reuses cached layers **until it hits the first instruction whose input changed**. Every instruction after that point rebuilds too, even if technically unchanged, because layers stack on top of each other.

### Bad order
```dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
```
Any file change — even an unrelated one like `index.js` — invalidates the `COPY . .` layer. That forces `npm install` to rerun on every single build, even when `package.json` hasn't changed. Slow.

### Good order
```dockerfile
FROM node:20
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
```
Now `npm install` only reruns when `package.json` / `package-lock.json` actually change. Editing app code only invalidates the final `COPY . .` layer — the expensive dependency install stays cached.

**Rule of thumb:** put things that change *least often* at the top of the Dockerfile, things that change *most often* at the bottom.

---

## 2. Multi-Stage Builds

Use a temporary "builder" stage with full tooling, then copy only what's needed into a lean final image.

```dockerfile
# Stage 1: build
FROM node:20 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build          # e.g. TypeScript compile, bundling, etc.

# Stage 2: production
FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json .
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Why it matters:**
- Final image excludes dev dependencies, build tools, source files not needed at runtime.
- Smaller image = faster pulls/deploys, smaller attack surface.
- `node:20-slim` (or `-alpine`) as the runtime base further reduces size vs the full `node:20` image.

---

## 3. .dockerignore

Always pair a Dockerfile with a `.dockerignore` — same idea as `.gitignore`, but for the build context.

```
node_modules
.git
.env
npm-debug.log
dist
```
Prevents host-specific or sensitive files from ever entering the image, and speeds up build context transfer.

---

## 4. Environment Variables — Config Per Container

The point of env vars: **one image, different runtime config per container**, instead of baking config/secrets into the image itself.

### At `docker run`
```bash
docker run -d --name app1 -e PORT=3000 -e DB_HOST=db1 myapp
docker run -d --name app2 -e PORT=3000 -e DB_HOST=db2 myapp
```

### From a file (keeps values out of shell history)
```bash
docker run -d --env-file .env.production myapp
```

### In Docker Compose, per service
```yaml
services:
  app1:
    image: myapp
    env_file: .env.app1
  app2:
    image: myapp
    env_file: .env.app2
```

### In your Node code
Just read normally — Docker injects vars into the process environment before your app starts:
```js
const port = process.env.PORT || 3000;
const dbHost = process.env.DB_HOST;
```
No Docker-specific handling needed in app code.

### What NOT to do
Never hardcode real secrets with `ENV` inside the Dockerfile:
```dockerfile
ENV DB_PASSWORD=supersecret   # BAD — baked into image layer permanently
```
Anyone with the image can extract this via `docker history <image>`. Secrets belong in `--env-file`, Compose `env_file`, or a proper secrets manager — never in the image itself.

---

## 5. Healthchecks

Let Docker know if your app is actually alive, not just "process running."

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
```
Shows up in `docker ps` as `healthy` / `unhealthy` — useful for load balancers and orchestration to know when to route traffic away from a broken container.

---

## 5b. Zero-Downtime Deploys

Layer caching (§1) makes **builds** fast. It does nothing about **deploy downtime** — those are two separate problems, and it's easy to conflate them. A hotfix that builds in 3 seconds can still cause a full outage if you swap containers naively. This section is about the second problem.

### Why the naive approach breaks

```bash
docker stop myserver && docker rm myserver
docker run -d --name myserver -p 3000:3000 myapp
```
Between `stop` and the new container becoming ready, there is a real gap — every request in that window fails. With a single container, this is unavoidable without extra tooling: there's nothing else to serve traffic while the swap happens.

### Why multiple containers + a load balancer is the actual fix

This is exactly what the nginx + multi-instance setup (see `hands-on.md`) is *for* — not just scaling throughput, but giving you redundancy so you can update containers **one at a time** while the others keep serving. This pattern is called a **rolling update**.

Manually, against our hands-on setup, a rolling update looks like:
```bash
docker build -t myapp .

docker stop app1 && docker rm app1
docker run -d --name app1 --network appnet -e INSTANCE_NAME=app1 myapp
# wait until app1 is confirmed healthy before continuing

docker stop app2 && docker rm app2
docker run -d --name app2 --network appnet -e INSTANCE_NAME=app2 myapp
# wait, confirm healthy

docker stop app3 && docker rm app3
docker run -d --name app3 --network appnet -e INSTANCE_NAME=app3 myapp
```
At every point in this sequence, at least 2 of 3 containers are up — nginx keeps routing to whichever are alive, so no request is dropped. This is why `HEALTHCHECK` (§5) matters here specifically: it's the mechanism that answers "is app1 actually ready to receive traffic yet" before you move on to app2. Without it, you're guessing with a sleep timer.

### The gotcha: `docker compose up -d --build` is not automatically zero-downtime

By default, Compose's update behavior is closer to the naive approach — it can stop and replace a service's containers without staggering them or waiting for health. For genuinely zero-downtime rolling updates, you need one of:

- **Manual staggering**, as shown above, scripted against Compose service names
- **Compose's `deploy.update_config`** settings (`order: start-first`, parallelism, health-based delay) — these only take effect in Swarm mode, not plain `docker compose up`
- **A real orchestrator** — Kubernetes, Swarm, ECS, etc. — where rolling updates are a built-in, first-class concept rather than something you script by hand

For local/small-scale setups (like our hands-on project), manual staggering with healthchecks is the honest, practical answer. Orchestrators become worth the added complexity once you're doing this often enough, or across enough containers, that scripting it by hand gets unreliable.

### The core idea, stated plainly

> Caching makes rebuilding fast. Redundancy (multiple containers) plus healthchecks plus staggered replacement is what makes *deploying* that rebuild safe. You need both, and they solve different problems.

---

## 6. Non-root User

By default containers run as root, which is unnecessary risk for most apps.

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
USER node
EXPOSE 3000
CMD ["node", "index.js"]
```
The official `node` image already ships a non-root `node` user — just switch to it with `USER node`.

---

## 7. Tagging Images Properly

Avoid relying on `latest` in production — it's ambiguous and not reproducible.

```bash
docker build -t myapp:1.4.0 .
docker build -t myapp:$(git rev-parse --short HEAD) .   # tie image to a commit
```
Lets you roll back precisely, and know exactly what code a running container corresponds to.

---

## 8. Quick Reference — What Changes From Dev to Production

| Concern              | Dev                        | Production                                  |
|-----------------------|-----------------------------|----------------------------------------------|
| Base image            | `node:20`                  | `node:20-slim` or `-alpine`, multi-stage      |
| Dependencies           | `npm install`               | `npm ci` (exact, reproducible installs)       |
| Secrets                | `.env` file, loose          | `--env-file` / secrets manager, never in image|
| User                   | root (default)              | dedicated non-root `USER`                     |
| Image tag              | `latest`                    | versioned tag or commit SHA                   |
| Health                 | none                        | `HEALTHCHECK` defined                         |
| Rebuild speed          | irrelevant                  | optimized via layer caching                   |
| Deploy strategy        | stop/rm/run, brief downtime OK | rolling update across containers, zero downtime |
