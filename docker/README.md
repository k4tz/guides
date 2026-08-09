# Docker Guide

A simplified Docker guide from beginner to practical. Just what you need to install it, use it daily, and eventually run it in production.

## Contents

### [`basic.md`](./basic.md)
Start here. Covers:
- Installing Docker Desktop on Windows
- The core mental model — images vs containers, where pulled images actually live, how the Docker daemon tracks everything
- Running multiple containers from one image, and using nginx as a reverse proxy/load balancer in front of them
- Core commands: pulling/building images, running/stopping/removing containers, exec/logs, volumes
- A full breakdown of what each line in a Dockerfile does, and the build vs. run distinction
- A "starter kit" of ~10 commands to memorize

### [`advanced.md`](./advanced.md)
Best practices and production-readiness. Covers:
- Layer caching — why instruction order in a Dockerfile matters, and how to structure it for fast rebuilds
- Multi-stage builds for smaller, safer production images
- `.dockerignore` and why it matters
- Environment variables — how to configure the same image differently per container, and what never to hardcode
- Healthchecks, running as a non-root user, and proper image tagging
- A dev-vs-production quick reference table

### [`hands-on.md`](./hands-on.md)
A progressive, fully runnable exercise. Starts with a single container, works up to **three app instances running behind an nginx load balancer, all orchestrated with Docker Compose.** Every command is meant to be typed and run, not just read.

Paired with [`hands-on-project/`](./hands-on-project) — the actual working code the guide walks through:
```
hands-on-project/
├── app/
│   ├── index.js         # minimal Node server, no dependencies
│   ├── package.json
│   └── Dockerfile
├── nginx.conf            # load balancer config
└── docker-compose.yml    # ties 3 app instances + nginx together
```
To use it: copy `hands-on-project/` anywhere on your machine, then follow `hands-on.md` from Step 2 onward.

## Suggested order

`basic.md` → `hands-on.md` (steps 1–3) → `advanced.md` → `hands-on.md` (steps 4 onward)

The hands-on guide is split so you can get comfortable with single-container basics before the advanced concepts, then come back once you understand *why* the Compose file is structured the way it is.
