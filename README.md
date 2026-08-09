# Guides

A personal collection of practical, no-fluff technical guides — tools explained the way you'd want a friend to explain them: skip the internals, get you productive fast, then layer in depth once the basics are second nature.

Each guide (mostly) follows the same three-tier structure:

1. **`basic.md`** — install steps, the core mental model, and the handful of commands you'll use 90% of the time.
2. **`advanced.md`** — best practices, production-readiness, things that matter once you're past "it runs on my machine."
3. **`hands-on.md`** — a progressive, runnable exercise tying the concepts together, usually backed by a small working project folder.

## Available guides

| Guide | Contents |
|-------|----------|
| [`docker/`](./docker) | Docker as a tool — install, core commands, Dockerfiles, Compose, production best practices, and a full hands-on exercise (multi-container app + nginx load balancer). |
| [`k8s/`](./k8s) | Kubernetes as a tool — picks up where `docker/` leaves off: what actually automates health-watching, rolling updates, and scaling that we scripted by hand in Docker. *(in progress — basics started)* |

More guides will be added here over time, following the same structure.

## How to use these

- New to the tool? Start with `basic.md` in the relevant folder.
- Comfortable with basics, want to do it right? Read `advanced.md`.
- Want to actually practice instead of just reading? Follow `hands-on.md` — it usually comes with a ready-to-run project folder alongside it.
