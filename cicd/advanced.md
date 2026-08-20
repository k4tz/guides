# CI/CD — Deployment Strategies & Production Pipeline Guide

Builds on `basic.md`. This covers what changes once a pipeline stops just testing/building and starts actually deploying — environments, approval gates, deployment strategies, and a full worked pipeline that pushes to AWS ECR and deploys to ECS, closing the loop `aws/basic.md` §6 left open.

---

## 1. Environments — Not Every Deploy Should Go Straight to Production

`basic.md`'s pipeline built an image. It never shipped it anywhere. The moment you add a deploy step, a new question appears: deploy it *where*?

Most real pipelines target at least two environments:
```
push to main → deploy to staging (automatic)
git tag v1.2.0 → deploy to production (gated)
```
**Staging** is a production-like environment nobody but your team relies on — the place to catch problems a laptop or a test suite won't. **Production** is what real users hit. The asymmetry is deliberate: staging deploys can be automatic and frequent, because a broken staging environment costs nothing but inconvenience. Production deploys should almost never be that casual.

### Environments as a platform feature, not just a naming convention

GitHub Actions (and most platforms) let you declare an environment a job deploys to, which unlocks protection rules — required reviewers, wait timers, secrets scoped to only that environment:
```yaml
  deploy-production:
    needs: build
    runs-on: ubuntu-latest
    environment: production      # this line is what enables approval gates, below
    steps:
      - run: echo "deploying..."
```
This is the direct extension of `basic.md` §5's secrets point: a `production` environment can have its own `secrets.PROD_DB_PASSWORD`, invisible to and unusable by a job targeting `staging` — the same isolation principle, scoped per environment rather than globally per repo.

### Requiring approval before production

Configured in the platform's UI (GitHub: Settings → Environments → production → required reviewers), not in the YAML itself. Once set, any job targeting `environment: production` pauses and waits for a human to click "approve" before it runs — automation up to the door of production, a deliberate human decision to walk through it.

---

## 2. Deployment Strategies — How the New Version Actually Replaces the Old One

`docker/advanced.md` §5b covered this at the container level (manually staggering `app1`/`app2`/`app3`) and flagged that a real orchestrator makes this "a built-in, first-class concept." This is that promise, made concrete — these are the standard named strategies, and how a pipeline triggers each one.

### Rolling deployment

Replace old instances with new ones gradually, a few at a time — exactly the manual staggering from `docker/advanced.md` §5b, except Kubernetes/ECS do it natively:
```bash
kubectl set image deployment/myapp myapp=myapp:1.4.0
# Kubernetes replaces pods a few at a time automatically, respecting the Deployment's
# rolling update settings (max unavailable / max surge) — see k8/basic.md §5
```
**Trade-off:** simple, no extra infrastructure, but for a short window both old and new versions are serving traffic simultaneously — fine for most changes, a real problem if old and new code can't coexist (e.g. an incompatible database migration).

### Blue-green deployment

Run the new version ("green") fully, in parallel, alongside the old one ("blue") — completely idle until you flip traffic over all at once:
```
[Blue: v1.3.0, live] ← 100% of traffic
[Green: v1.4.0, running, idle] ← 0% of traffic

# once Green is confirmed healthy:
[Blue: v1.3.0, idle]
[Green: v1.4.0, live] ← 100% of traffic
```
**Trade-off:** instant, total cutover (and instant rollback — just flip back), but you're running double the infrastructure for the overlap period, and it doesn't solve the "old and new can't coexist" database problem either — the database is still shared by both.

### Canary deployment

Send a small percentage of real traffic to the new version, watch for problems, gradually increase:
```
v1.4.0 gets 5% of traffic → watch error rates/latency
  → looks fine → 25% → 50% → 100%
  → looks bad  → route back to 0%, no full rollout ever happened
```
**Trade-off:** the safest way to catch a problem that only shows up under real production traffic patterns, but needs real infrastructure to support (a service mesh or load balancer capable of weighted routing — see `k8/networking.md` on this exact capability) and is meaningfully more complex to set up than the other two.

### Picking one

| Situation | Lean toward |
|---|---|
| Small team, simple app, comfortable with brief mixed-version windows | Rolling |
| Need instant rollback capability, can afford double infrastructure briefly | Blue-green |
| High-traffic production system, want to catch issues before they're global | Canary |
| Just starting out | Rolling — it's what your orchestrator does by default; the others are deliberate upgrades once you have a specific reason |

---

## 3. Rollbacks — When the New Version Is the Problem

A deploy step without a rollback plan is a bet you can't undo. Both patterns from earlier guides apply directly, at the pipeline level:

```bash
# Kubernetes — same mechanism as k8/basic.md, triggered from a pipeline step instead of by hand
kubectl rollout undo deployment/myapp

# Or, the git-native equivalent — re-deploy a previous, known-good tag
git tag                       # find the last good version
# then re-run the deploy job, pointed at that tag's image instead of building fresh
```
The second option is why `git/advanced.md` §2's insistence on annotated, meaningful tags matters beyond readability — a tag is literally what a rollback re-deploys. A history of `v1.2.0`, `v1.3.0`, `v1.4.0` gives you exact rollback targets; a history of `latest` overwritten repeatedly gives you nothing to roll back *to*.

**The honest rule:** a rollback should be at least as automated as the deploy itself. If deploying takes one pipeline run but rolling back requires someone remembering five manual steps under pressure, the rollback plan doesn't really exist — see `git/advanced.md` §4 on hotfixes for the same "isolate the fix, don't improvise under pressure" principle.

---

## 4. Full Worked Pipeline — AWS ECR + ECS

Closing the loop `aws/basic.md` §6 named directly as the thing that triggers a redeploy — a CI/CD pipeline step calling `aws ecs update-service`. This is that pipeline, end to end — build, push to ECR, update the ECS service — triggered on a version tag, following `git/advanced.md`'s GitHub Flow + Semantic Versioning conventions.

### Prerequisites (one-time AWS setup, not pipeline steps)

- An ECR repository already created (`aws ecr create-repository --repository-name myapp`)
- An ECS cluster and service already running (from `aws/basic.md`'s ECS Fargate or Express Mode path)
- An IAM role the pipeline can assume, scoped to just ECR push + ECS update — not broad admin access (least-privilege, same principle as `k8/advanced.md`'s IRSA)

### The ECS Task Definition

This is the ECS equivalent of the Kubernetes Deployment YAML from `k8/basic.md` §5 — it describes what should run, not what's currently running:
```json
{
  "family": "myapp",
  "containerDefinitions": [
    {
      "name": "myapp",
      "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/myapp:PLACEHOLDER",
      "portMappings": [{ "containerPort": 3000 }],
      "environment": [
        { "name": "LOG_LEVEL", "value": "info" }
      ],
      "secrets": [
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:myapp-db-password"
        }
      ]
    }
  ],
  "cpu": "256",
  "memory": "512"
}
```
The `"secrets"` block is ECS's equivalent of the Kubernetes Secret reference from `k8/basic.md` §6 — the value lives in AWS Secrets Manager, and only an ARN pointer appears in this file, which is safe to commit. `PLACEHOLDER` gets replaced with a real image tag by the pipeline on every run — never hand-edited.

### The pipeline

`.github/workflows/deploy.yml`:
```yaml
name: Deploy to ECS

on:
  push:
    tags:
      - 'v*.*.*'          # matches v1.4.0, v1.4.1, etc — see git/advanced.md §2

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: myapp
  ECS_CLUSTER: myapp-cluster
  ECS_SERVICE: myapp-service

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr-login

      - name: Build and push image
        env:
          ECR_REGISTRY: ${{ steps.ecr-login.outputs.registry }}
          IMAGE_TAG: ${{ github.ref_name }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

      - name: Update ECS task definition
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definition.json
          container-name: myapp
          image: ${{ steps.ecr-login.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ github.ref_name }}

      - name: Deploy to ECS
        uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          cluster: ${{ env.ECS_CLUSTER }}
          service: ${{ env.ECS_SERVICE }}
          wait-for-service-stability: true
```

### Reading the parts that are new

**`tags: ['v*.*.*']`** — the trigger is a version tag, not a branch push. This is `git/advanced.md` §2/§3 made operational: pushing `git tag -a v1.4.0 -m "..."` and `git push origin v1.4.0` from your terminal is what starts this entire pipeline. A tag isn't just documentation of a release here — it's the deploy button.

**`role-to-assume` via OIDC, not a long-lived AWS key** — `aws-actions/configure-aws-credentials` here uses GitHub's OIDC identity to assume a short-lived AWS role, rather than storing a permanent AWS access key as a secret. This matters because a leaked long-lived key is a standing risk forever; a leaked OIDC-derived credential expires within the hour.

**`github.ref_name`** — when triggered by a tag push, this resolves to the tag name itself (`v1.4.0`) — the image gets tagged in ECR with the exact same string as the git tag that triggered the build. This is the practical payoff of §3's rollback point: `docker/myapp:v1.4.0` and `git tag v1.4.0` refer to the literal same release, provably, by construction.

**`wait-for-service-stability: true`** — the pipeline doesn't consider the deploy done the instant `update-service` is called; it waits and confirms ECS actually reports the new tasks healthy before finishing. Without this, a pipeline can report green while the actual rollout is still failing behind the scenes — the CI/CD-level version of the healthcheck point from `docker/advanced.md` §5.

**`environment: production`** — from §1. This job pauses for approval before any of this runs, if you've configured required reviewers.

### What this pipeline is doing, end to end

```
git tag v1.4.0 && git push origin v1.4.0
  → GitHub Actions trigger fires
  → (if configured) pipeline pauses for approval
  → assumes a scoped AWS role via OIDC
  → docker build + push to ECR, tagged v1.4.0
  → renders a new ECS Task Definition pointing at that exact image
  → calls the ECS equivalent of "update-service" with it
  → waits, confirms the new tasks are actually healthy
  → done — v1.4.0 is now what's running in production
```
Every earlier guide in this series fed into one line of this sequence: `git/` for the tag, `docker/` for the build, `aws/` for what ECR/ECS actually are, `k8/`'s ConfigMap/Secret pattern for how the Task Definition's `secrets` block is structured. This pipeline is the thing that actually executes all of it, unattended, from a single tag push.

---

## 5. Quick Reference — What Changes From a First Pipeline to Production-Ready

| Concern | First pipeline (`basic.md`) | Production-ready |
|---|---|---|
| Deploy target | None — build only | Staging (auto) + production (gated) |
| Trigger | Push to any branch | Tag push (`v*.*.*`) for production |
| Approval | None | Required reviewers on `environment: production` |
| AWS credentials | N/A | Short-lived OIDC role, never a static key |
| Deployment strategy | N/A | Rolling / blue-green / canary, chosen deliberately |
| Rollback | N/A | At least as automated as the deploy itself |
| Image tag | Commit SHA or none | Matches the git tag exactly, traceable both directions |
| Deploy confirmation | N/A | Pipeline waits for actual health, not just "command ran" |

---

## 6. What to Skip For Now

- Multi-region deployment pipelines — only relevant once `aws/basic.md`'s multi-region trigger conditions are actually met
- Feature flags as a deploy-decoupling mechanism (separating "deployed" from "released to users") — a genuinely different, complementary tool to everything above, worth a dedicated look once canary/blue-green feel routine
- GitOps (Argo CD, Flux — a pull-based model where a cluster-side agent applies changes, instead of the pipeline pushing them) — a real alternative architecture to everything in §4, not a small addition to it
- Infrastructure as Code (Terraform, CDK) for provisioning the ECS cluster/ECR repo themselves — this guide assumed that infrastructure already exists; provisioning it is its own subject

---

## See more

- [GitHub Actions: Using environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [Configuring OIDC in AWS from GitHub Actions](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [amazon-ecs-deploy-task-definition (GitHub Action)](https://github.com/aws-actions/amazon-ecs-deploy-task-definition)
- [ECS Task Definition reference](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/)
- [Kubernetes deployment strategies](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy)