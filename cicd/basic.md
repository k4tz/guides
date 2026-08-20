# CI/CD Basics — A Practical Guide

Just the concept and one real tool, no platform-by-platform tour. If you've been through `git/` and `docker/`, this is the guide that finally wires "I pushed a commit" to "the new version is live" — the step every other guide in this series has been pointing at and deferring.

---

## 1. What CI/CD Actually Is

**CI (Continuous Integration):** every time code is pushed, automatically build it and run the tests — before a human has to.
**CD (Continuous Delivery/Deployment):** if CI passes, automatically get that code running somewhere — staging, production, or both.

Neither of these is a tool. They're a practice, and a **pipeline** (or **workflow**) is the automated script that implements them — a sequence of steps a CI/CD platform runs for you, triggered by something happening in git.

### The trigger is always a git event

This is the seam `git/advanced.md` left open: a pipeline doesn't run on a schedule by default, it runs *because* something happened in git.
```
git push  → triggers → CI runs tests
merge to main → triggers → CD deploys to staging
git tag v1.2.0 → triggers → CD deploys to production
```
None of this is git functionality — git just exposes the events (push, merge, tag) that a CI/CD platform is *listening* for. The platform is a separate service watching your repo.

### Where the platform actually runs your steps

A CI/CD platform doesn't run jobs on your laptop — it spins up a **fresh, disposable machine** (usually a container, sometimes a full VM) for every single run, executes your steps on it, then throws it away. This matters: nothing persists between runs unless you deliberately cache or store it (§6), and this is exactly the same "container is a stopped instance, not a filesystem you can rely on" idea from `docker/basic.md` §2 — a CI runner has that identical throwaway nature by default.

---

## 2. The Vocabulary

| Term | What it means |
|---|---|
| **Pipeline / Workflow** | The whole automated process, defined in a YAML file that lives in your repo |
| **Stage** | A logical phase (e.g. "test," "build," "deploy") — stages usually run in order |
| **Job** | A unit of work within a stage — jobs in the same stage can often run in parallel |
| **Step** | One command inside a job — the actual thing that executes |
| **Runner** | The disposable machine actually executing your steps |
| **Artifact** | A file produced by one job that a later job needs (a built binary, a Docker image, a test report) |
| **Trigger** | The git event that starts the pipeline — push, PR, merge, tag |

### How they nest

```
Pipeline
└── Stage: test
    └── Job: run-unit-tests
        ├── Step: checkout code
        ├── Step: install dependencies
        └── Step: npm test
└── Stage: build
    └── Job: build-image
        ├── Step: docker build
        └── Step: push to registry
└── Stage: deploy
    └── Job: deploy-to-staging
        └── Step: kubectl apply / aws ecs update-service
```
Stages generally run in sequence — `build` waits for `test` to pass, `deploy` waits for `build`. Jobs within a stage can often run in parallel, since they usually don't depend on each other.

---

## 3. Picking a Platform

There's no single "correct" one — the right choice is almost always **wherever your code already lives.**

| Platform | Best for |
|---|---|
| **GitHub Actions** | You're already on GitHub — zero extra setup, config lives in `.github/workflows/` |
| **GitLab CI/CD** | You're already on GitLab — same idea, config lives in `.gitlab-ci.yml` |
| **CircleCI / Jenkins** | Multi-platform needs, or legacy/self-hosted requirements — more setup, more flexibility |

This guide uses **GitHub Actions** for every example, since it's the most common default and needs no separate account or service to start — it's built into GitHub itself. The core concepts (stages, jobs, triggers, artifacts) carry over to any other platform with different YAML syntax.

---

## 4. A Real, Minimal Pipeline

Building on `docker/basic.md`'s Node example — a repo with `index.js`, `package.json`, and a `Dockerfile`. This runs tests on every push, and only builds the Docker image if tests pass.

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t myapp:${{ github.sha }} .
```

### Reading this line by line

**`on:`** — the trigger. Runs on every push to `main`, and on every pull request targeting `main` (so you see test results *before* merging, not after).

**`jobs:`** — two jobs, `test` and `build`.

**`runs-on: ubuntu-latest`** — the disposable runner's OS. GitHub provisions a fresh Ubuntu VM for this job specifically.

**`uses: actions/checkout@v4`** — pulls your repo's code onto the runner. The runner starts empty; nothing about your code exists on it until this step. This is worth sitting with: the very first thing almost every job does is essentially `git clone` itself.

**`uses: actions/setup-node@v4`** — a pre-built, reusable step ("Action") that installs Node 20 on the runner. `uses:` steps are pulled from a marketplace of shared, reusable pipeline building blocks — you rarely write raw install scripts by hand for common tools.

**`run: npm ci`** — a raw shell command. `npm ci` specifically (not `npm install`) because it does an exact, reproducible install from the lockfile — this is the same dev-vs-production distinction `docker/advanced.md` §8 draws for the same reason: reproducibility matters more here than in casual local development.

**`needs: test`** — this is the stage-ordering mechanism. The `build` job will not start until `test` finishes successfully. Remove this line and both jobs would run in parallel, meaning you might build an image from code that fails its own tests.

**`${{ github.sha }}`** — the current commit's hash, injected as the image tag. This is `git/advanced.md` §2's Semantic Versioning point in a different form: tag with something meaningful, never `latest`, so you always know exactly which commit a running image came from.

---

## 5. Secrets — Never in the YAML File

This pipeline file is committed to git, in a public or shared repo — anything written directly in it is visible to everyone with read access, forever, in history, even if you delete it later (see `docker/advanced.md` §4 on the identical mistake with `ENV` in a Dockerfile).

CI/CD platforms provide a separate, encrypted secrets store for exactly this reason:
```yaml
      - run: docker login -u ${{ secrets.DOCKER_USERNAME }} -p ${{ secrets.DOCKER_PASSWORD }}
```
`secrets.DOCKER_PASSWORD` is configured once in the repo's settings (GitHub: Settings → Secrets and variables → Actions) — never in the YAML itself. The pipeline references it by name; the actual value never appears in your file, your logs, or your git history.

This is the same ConfigMap/Secret split from `k8/basic.md` §6, one layer earlier in the pipeline: config that's fine to see (branch names, Node version) lives in the YAML directly; anything sensitive (credentials, tokens, API keys) lives in the platform's secrets store and is only ever referenced, never written out.

---

## 6. Caching — Making Runs Faster

Every run starts from a disposable, empty machine (§1) — meaning `npm ci` re-downloads every dependency from scratch, every single time, unless you tell the platform to cache them.
```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
```
This single `cache: 'npm'` line persists `node_modules`' download cache between runs, keyed off your lockfile — change `package-lock.json`, cache invalidates and rebuilds; leave it alone, subsequent runs reuse it. This is conceptually identical to Docker's layer caching from `docker/advanced.md` §1: same principle (skip redoing work that hasn't changed), applied one level up, to the pipeline itself rather than the image build inside it.

---

## 7. Artifacts — Passing Files Between Jobs

Each job in §4 runs on its **own separate runner** — the `build` job doesn't automatically have access to anything the `test` job produced, even though they're part of the same pipeline. If a later job needs a file an earlier one made (a test report, a compiled binary), it has to be explicitly passed along:
```yaml
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
```
A later job (or a human, from GitHub's UI) can then download `coverage-report`. This is worth internalizing early: jobs are isolated by default, not by exception — the throwaway-runner model from §1 applies *between* jobs in the same pipeline, not just between separate pipeline runs.

---

## 8. What to Skip For Now

- Actual deployment steps (`kubectl apply`, `aws ecs update-service`) — this requires environments, approval gates, and rollback thinking; covered properly in `advanced.md`
- Matrix builds (running the same job across multiple OS/language versions in parallel) — useful once you support multiple environments, not needed for a first pipeline
- Self-hosted runners — only relevant once GitHub's hosted runners don't fit (specific hardware, network access, cost at scale)
- Reusable/composite workflows — worth learning once you're maintaining several similar pipelines and copy-pasting YAML between them
- Monorepo-specific pipeline strategies (path filtering, selective builds) — a real problem, but a distinct one from the core CI/CD concepts here

---

## Starter Kit — the mental checklist for any new pipeline

```
1. What triggers this? (push / PR / merge / tag)
2. What stages, in what order? (test → build → deploy)
3. What does each job actually need? (checkout, language/runtime setup)
4. What's secret? (→ secrets store, never in the YAML)
5. What's slow and cacheable? (→ cache key off the lockfile)
6. What does a later job need from an earlier one? (→ artifact)
```

---

## See more

- [GitHub Actions docs](https://docs.github.com/en/actions)
- [GitHub Actions workflow syntax reference](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)
- [GitHub Actions Marketplace](https://github.com/marketplace?type=actions) — the reusable `uses:` steps referenced in §4
- [GitLab CI/CD docs](https://docs.gitlab.com/ee/ci/) — for the GitLab-equivalent syntax
- [Encrypted secrets (GitHub)](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)