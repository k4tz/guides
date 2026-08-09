# Docker Basics — A Practical Guide

Just the tool, no internals. If you know git commands, this maps similarly.

---

## 1. Install

- Install [Docker Desktop](https://docs.docker.com/desktop/) (includes Engine, CLI, Compose). Needs WSL2 — installer sets it up or prompts you (WSL2 is windows only requirement)
- Launch Docker Desktop once and leave it running. Nothing works without it.
- Verify:
```
docker --version
docker run hello-world
```

---

## 2. Mental Model

| Concept   | What it is                                  |
|-----------|----------------------------------------------|
| Image     | Frozen template/blueprint (like a class)     |
| Container | Running (or stopped) instance of an image (like an object) |
| Dockerfile| Instructions to build your own image         |
| Registry  | Docker Hub — where images live remotely      |

### Where do pulled images actually go?

Unlike `git clone`, there's no project folder involved. `docker pull nginx` stores the image inside **Docker's own internal storage** (in the Linux VM Docker Desktop runs via WSL2) — not in your working directory. It's global to your Docker installation, like npm's global cache.

### Is it "registered" with Docker?

Yes. A background service called the **Docker daemon** (`dockerd`) keeps track of:
- every image you've pulled/built (`docker images` reads this)
- every container, running or stopped (`docker ps -a` reads this)
- networking between containers

The `docker` CLI is just a client talking to this daemon. The daemon is the source of truth — that's why Docker Desktop must be running first.

### Running multiple containers from one image

An image is a read-only template — running it doesn't lock or consume it. You can spin up as many independent containers from the same image as you want:
```
docker run -d --name app1 -p 3001:3000 myapp
docker run -d --name app2 -p 3002:3000 myapp
docker run -d --name app3 -p 3003:3000 myapp
```
Each container is isolated, with its own filesystem layer and process space. This is the basic mechanism behind horizontal scaling.

### Nginx as a reverse proxy / load balancer

Common real-world pattern. Put containers on the same **custom Docker network** so they can resolve each other by name — only the proxy needs a host-facing port.

```
docker network create appnet

docker run -d --name app1 --network appnet myapp
docker run -d --name app2 --network appnet myapp
docker run -d --name app3 --network appnet myapp

docker run -d --name proxy --network appnet -p 80:80 \
  -v $(pwd)/nginx.conf:/etc/nginx/nginx.conf:ro nginx
```

`nginx.conf`:
```nginx
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
```

Docker's internal DNS resolves `app1`, `app2`, `app3` to the right container IPs automatically. This is exactly the kind of setup Docker Compose is built to express more cleanly (see §8).

---

## 3. Images — get / build / manage

```
docker pull nginx              # download image from Docker Hub
docker images                  # list local images
docker rmi <image_id>          # delete an image
docker build -t myapp .        # build image from Dockerfile in current dir
```

---

## 4. Containers — run / stop / manage

```
docker run nginx                       # run in foreground
docker run -d nginx                    # run in background (detached)
docker run -d -p 8080:80 nginx         # map host port 8080 -> container port 80
docker run -d --name myweb nginx       # give it a friendly name

docker ps                              # list running containers
docker ps -a                           # list ALL containers (incl. stopped)

docker stop <name_or_id>               # stop a container
docker start <name_or_id>              # start a stopped container
docker restart <name_or_id>            # restart

docker rm <name_or_id>                 # delete a stopped container
docker rm -f <name_or_id>              # force delete (even if running)
```

---

## 5. Debugging a container

```
docker exec -it <name_or_id> bash      # shell inside a running container
docker logs <name_or_id>               # view logs
docker logs -f <name_or_id>            # follow logs live
```

---

## 6. Volumes (persisting data)

Containers are throwaway by default — data dies when you delete them.

```
docker volume create mydata
docker run -d -v mydata:/app/data nginx     # named volume
docker run -d -v $(pwd):/app nginx          # bind mount (map local folder in)
```

---

## 7. Dockerfile basics

```dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "index.js"]
```
```
docker build -t myapp .
docker run -d -p 3000:3000 myapp
```

---

## 7b. Dockerfile Walkthrough — Node Backend Example

Say your project root has `index.js`, `package.json`, `node_modules`, and a `Dockerfile`:

```dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD ["node", "index.js"]
```

### Step by step

**`FROM node:20`**
Pulls (or reuses cached) the official `node:20` image — a minimal Linux OS with Node.js 20 preinstalled. This is the base layer everything else builds on.

**`WORKDIR /app`**
Creates `/app` inside the image's filesystem and sets it as the working directory for all following instructions — like `mkdir /app && cd /app`. This filesystem exists only inside the image, unrelated to your host folder structure.

**`COPY . .`**
Copies files from the build context (your project root, on your actual machine) into `/app` inside the image. First `.` = source (host), second `.` = destination (`/app`, because of `WORKDIR`). This copies everything — including `node_modules` if not excluded (see gotcha below).

**`RUN npm install`**
Runs `npm install` *inside the image*, using the `package.json` just copied in. This happens once, during **build**, producing an image-native `node_modules`.

**`EXPOSE 3000`**
Documentation only — declares "this container listens on 3000." Doesn't actually publish the port; you still need `-p` at `docker run` time.

**`CMD ["node", "index.js"]`**
The default command a **container** runs when started from this image. Not executed during build — only when you `docker run`.

### Build vs Run — two distinct moments

```
docker build -t myapp .
```
Executes `FROM`, `WORKDIR`, `COPY`, `RUN`, `EXPOSE` — produces a finished, reusable image `myapp` stored in Docker's internal storage. `npm install` runs once, here.

```
docker run -d -p 3000:3000 --name myserver myapp
```
Creates a **container** from that image and runs `CMD` — starts `node index.js`. No installing or copying here — just running what was already baked in at build time.

### Gotcha: node_modules

`COPY . .` copies your host `node_modules` too, if present — which can carry OS-specific binaries that break on Linux. Fix with a `.dockerignore` file:
```
node_modules
.git
```
This excludes them from the copy, so the image relies solely on its own `RUN npm install` to produce a clean, Linux-native `node_modules`.

---

## 8. Docker Compose (multi-container apps)

Instead of many long `docker run` commands, define everything declaratively:

```yaml
version: "3"
services:
  web:
    build: .
    ports:
      - "3000:3000"
  db:
    image: postgres
    environment:
      POSTGRES_PASSWORD: example
```
```
docker compose up -d      # start everything
docker compose down       # stop and remove everything
docker compose logs -f    # follow logs
```

---

## 8b. Updating an Image

With docker, **an image does not track its source.** Once built, it's a frozen, inert artifact — it has no pointer back to the Dockerfile, no awareness of your project folder, no idea when your code changes. Docker never "notices" a change and never updates anything automatically.

### There is no "update" command — only rebuild

```bash
docker build -t myapp .
```
This is the entire update mechanism. Every time you run it, Docker reads whatever the Dockerfile and build context look like *right now* and produces a new image. If you change `index.js` and don't rebuild, every container you run from `myapp` still contains the old code — forever, until you rebuild.

### A running container never updates either

A **container** stays locked to the image it was created from, even if you rebuild a new image under the same tag afterward. To get new code live, you must replace the container:
```bash
docker build -t myapp .
docker stop myserver && docker rm myserver
docker run -d --name myserver -p 3000:3000 myapp
```
With Compose, this collapses into one command:
```bash
docker compose up -d --build
```
`--build` rebuilds first, then Compose replaces any containers whose image changed.

### The mental model, stated plainly

| git | Docker |
|---|---|
| `git pull` updates your working directory in place | *(no equivalent)* — images never update in place |
| tracks history and diffs automatically | tracks nothing about source; an image is a frozen snapshot |
| one repo, continuously evolving | every build produces a new, independent image |

The closer git analogy isn't `git pull` — it's `git commit` producing a new, permanently frozen hash each time, except there's no "check out the old one back into place." You only ever build forward and swap containers to what's new.

This is also why tagging matters (see `advanced.md` — Tagging Images Properly): `myapp:1.0.0` and `myapp:1.0.1` are two completely independent images. Nothing links them except the naming convention you chose to use.

**Note:** the sequence above (`stop` → `rm` → `run`) causes a real gap where your app is down. That gap, and how to avoid it with multiple containers, is covered in `advanced.md` — Zero-Downtime Deploys.

---

## 9. Cleanup

```
docker system prune            # remove unused containers/images/networks
docker system prune -a         # more aggressive, also removes unused images
```

---

## 9b. Extra - Install guides

Official install guides:

- [Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
- [macOS](https://docs.docker.com/desktop/setup/install/mac-install/)
- [Linux](https://docs.docker.com/desktop/setup/install/linux/) (Ubuntu, Debian, Fedora, Arch, RHEL)

One nuance: on Linux, Docker Desktop is optional. Linux can run containers natively, so you can install just **Docker Engine** (CLI + daemon, no GUI, no VM) directly instead — see the [Engine install docs](https://docs.docker.com/engine/install/). Windows and macOS need Docker Desktop (or Engine plus a manually managed VM) because they can't run Linux containers natively.

---

## 10. What to skip for now

- Dockerfile multi-stage builds, build caching internals
- Docker Swarm (orchestration/clustering — overkill early on)
- Registry auth / publishing to Docker Hub (only needed when sharing images)
- Underlying namespaces/cgroups (irrelevant to daily use)

---

## Starter Kit — 10 commands to memorize

```
docker pull <image>
docker images
docker run -d -p host:container --name X <image>
docker ps / docker ps -a
docker stop/start X
docker rm X
docker exec -it X bash
docker logs -f X
docker build -t X .
docker compose up -d / down
```

---

## See more

- [Docker Desktop overview](https://docs.docker.com/desktop/) — official landing page, install links for all platforms
- [Docker Desktop install: Windows](https://docs.docker.com/desktop/setup/install/windows-install/) / [macOS](https://docs.docker.com/desktop/setup/install/mac-install/) / [Linux](https://docs.docker.com/desktop/setup/install/linux/)
- [Docker Engine install (Linux, no Desktop/GUI)](https://docs.docker.com/engine/install/)
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker CLI reference](https://docs.docker.com/reference/cli/docker/)
- [Docker Compose docs](https://docs.docker.com/compose/)
