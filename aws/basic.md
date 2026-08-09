# AWS Basics — Hosting & Deployment Options

Builds on `docker/` and `k8s/`. Answers the practical question those guides lead to: **once you have a Docker image, where does it actually run on AWS, and which option fits your situation?**

This is not a general AWS tour — just the hosting/compute decision, since that's what "deploying your app" boils down to.

---

## 1. The Core Idea — AWS Compute Options Are a Ladder of Abstraction

Every option below ultimately runs your container on EC2 machines somewhere — what differs is how much of that machinery you personally manage versus AWS managing it for you.

```
More control, more manual work                    Less control, more automated
◄────────────────────────────────────────────────────────────────────────────►

  EC2 (raw)  →  EC2 + ASG  →  ECS on EC2  →  ECS Fargate  →  ECS Express Mode
                                                  │
                                                EKS (Kubernetes, on EC2 or Fargate)
```

Fargate is a separate axis worth naming up front: it means "run containers without picking or managing any EC2 instances yourself" — AWS handles the underlying machines invisibly. Both ECS and EKS can run on Fargate.

---

## 2. The Options, Explained Plainly

### EC2 (raw)
Just a virtual machine. Install Docker yourself, run containers with `docker run` yourself, no orchestration. Horizontal scaling isn't automatic — you'd need to build it yourself.

### EC2 + Auto Scaling Group (ASG) + Load Balancer (ALB)
Adds/removes whole EC2 instances automatically based on load, spreads traffic across them. Real horizontal scaling — but still no container orchestration; you're deciding what runs on each machine yourself (or scripting it).

### ECS (Elastic Container Service) — EC2 launch type
AWS's own container orchestrator (an alternative to Kubernetes). You still manage the underlying EC2 instances, but ECS handles container placement, restarts, and rolling updates on top of them. $0 control-plane cost.

### ECS Fargate
Same ECS orchestration, but no EC2 instances to manage at all — you specify vCPU/memory per task and AWS runs it somewhere. You pay per task, not per idle server.

### ECS Express Mode
The current recommended easy path (as of mid-2026). <cite index="21-1">Same underlying compute as Fargate, but automates cluster creation, load balancer setup, HTTPS, security groups, autoscaling, and monitoring — point it at an image in ECR and it handles the rest.</cite> Closest thing to "just deploy it" while staying inside plain ECS.

> **Note:** AWS App Runner (previously the simplest "just deploy a container" option) <cite index="21-2">moved to maintenance mode in 2026 — no new features, closed to new customers after April 30, 2026</cite>. ECS Express Mode is AWS's official replacement path.

### EKS (Elastic Kubernetes Service)
Real, managed Kubernetes — same concepts as `k8s/basic.md` (Deployments, Services, `kubectl`), except AWS runs the control plane. <cite index="16-1">Costs roughly $73/month for the control plane alone, before running a single container</cite> — a real cost EC2/ECS don't have. Worth it mainly if you need Kubernetes specifically (portability across clouds, team already knows it, complex orchestration needs).

---

## 3. Classification Table — Scale, Complexity, Cost, Ease

| Option | Scale ceiling | Complexity to operate | Relative cost | Ease of getting started |
|---|---|---|---|---|
| EC2 (raw) | Low, manual | Low (conceptually), high (operationally — you build everything) | Cheapest at small scale | Easy to start, hard to run well |
| EC2 + ASG + ALB | High | Medium — you manage AMIs/instance config | Cheap, scales with usage | Medium |
| ECS on EC2 | High | Medium — still manage EC2 fleet | Cheap (no Fargate premium) | Medium |
| ECS Fargate | High | Low — no servers to manage | Higher per-compute-hour than EC2, no idle-server waste | Easy |
| ECS Express Mode | High | Very low | Similar to Fargate + convenience | Easiest container option |
| EKS | Very high | High — real Kubernetes operational knowledge needed | Fargate-level compute cost + ~$73/mo control plane | Hard |

A useful rule of thumb from real cost comparisons: <cite index="16-2">Fargate can cost meaningfully more than self-managed EC2 for identical always-on workloads, because you pay for allocated resources rather than efficiently bin-packing multiple services onto shared machines</cite> — Fargate's convenience has a real price tag at scale, not just at the EKS control-plane level.

---

## 4. Global Traffic Is a Different Problem Than Compute Choice

Important distinction: **none of the options above solve "users across the globe" by themselves.** Every one of them runs in a single AWS region unless you deliberately deploy to more than one. Global reach is a separate, additive layer:

- **CloudFront** (CDN) — caches static assets close to users worldwide; cheap, easy, high impact
- **Route 53** (DNS, latency/geo-based routing) — routes users to their nearest deployment, if you have more than one
- **Multi-region deployment** — running your actual compute stack in 2+ regions; a real jump in cost and operational complexity, usually only justified at much larger scale or strict latency requirements

For most apps, **single region + CloudFront in front** absorbs the bulk of "global" pain cheaply. Multi-region active-active is a later-stage decision, not a starting one.

---

## 5. Worked Example — Niche Platform, ~100k Users, Global-ish Traffic

Reasoning through the ladder for this specific case:

- **Raw EC2**: no — you'd be manually building the scaling/health/rollout automation this whole guide series has been about avoiding.
- **EKS**: probably overkill — the $73/mo control plane plus real Kubernetes operational overhead isn't justified unless you specifically need Kubernetes portability or already have that expertise. 100k users doesn't require it.
- **ECS Fargate or ECS Express Mode**: the sensible fit. Handles autoscaling and rolling updates automatically, no servers to manage, and comfortably handles this scale.
- **Global traffic**: add CloudFront in front of a single-region ECS deployment. Skip multi-region entirely at this scale — the added complexity isn't earned yet.

**Suggested starting stack:** ECS Express Mode (or Fargate directly if you want more control) + ECR for images + CloudFront for global static asset delivery + a single well-chosen region (e.g. one close to your largest user segment).

This is also roughly the point where it's worth revisiting EC2 + ASG as a cost-optimization move later, once traffic patterns are well understood and the Fargate convenience premium becomes worth trading for manual efficiency — but not as a starting point.

---

## 6. How the Pieces Connect to What You Already Know

| From `docker/`/`k8s/` | AWS equivalent |
|---|---|
| `docker build` | Unchanged — same Dockerfile, same build |
| Docker Hub | **ECR** (Elastic Container Registry) — `docker push` to an ECR URL instead |
| `docker-compose.yml` describing services | ECS **Task Definition** (or K8s manifests, if using EKS) |
| Manually staggered rolling update (`docker/hands-on.md` Step 7) | ECS/EKS built-in rolling deployment — same concept, now automatic |
| nginx load balancer we hand-configured | **Application Load Balancer (ALB)** — managed, automatic |
| `docker compose up -d --build` triggering a redeploy | CI/CD pipeline step calling `aws ecs update-service` (or `kubectl apply` for EKS) |

Nothing about the Docker fundamentals changes — this guide is entirely about what sits *around* the image once it's built.

---

## 7. What to Skip For Now

- Multi-region / active-active setups — not needed until you have a concrete reason
- EKS — skip unless you specifically need Kubernetes
- Fine-grained IAM policy design, VPC networking internals — needed eventually, not for getting a first deployment running
- Reserved Instances / Savings Plans cost optimization — relevant once usage patterns are established, not before

---

## See more

- [AWS ECS overview](https://aws.amazon.com/ecs/)
- [ECS Express Mode announcement/docs](https://aws.amazon.com/ecs/)
- [AWS EKS overview](https://aws.amazon.com/eks/)
- [Amazon ECR](https://aws.amazon.com/ecr/)
- [CloudFront](https://aws.amazon.com/cloudfront/)
- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)
