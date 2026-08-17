# Kubernetes Guide

Kubernetes as a practical tool — what it actually automates, and how it maps to Docker concepts you already know. Picks up the question left open at the end of the Docker guide: *what handles health-watching, rolling updates, and scaling automatically, instead of scripting it by hand?*

## Contents

### [`basic.md`](./basic.md)
Start here. Covers:
- What you need to install (`kubectl`, a local cluster via Minikube) and why it's three separate pieces, not one tool
- The core mental model — Pods, Deployments, Services, Nodes, and how each maps to a Docker/Compose concept you already know
- The one idea that explains most of Kubernetes: **declared desired state + continuous reconciliation**, versus Docker's one-shot imperative commands
- Core `kubectl` commands
- A minimal Deployment + Service example, annotated against what the equivalent Docker Compose + nginx setup was doing manually
- What to deliberately skip for now (Helm, multi-node clusters, Ingress, RBAC, etc.)

### [`advanced.md`](./advanced.md)
Production-readiness. Covers:
- Rollout strategy in depth — `maxSurge`/`maxUnavailable`, why the Kubernetes default isn't zero-downtime, and the exact config that is
- All three probe types (readiness, liveness, startup) and what each actually controls
- Rollback via `kubectl rollout undo`, and why specific image tags (not `latest`) make it meaningful
- Crash and error handling — CrashLoopBackOff, reading logs from a crashed container with `--previous`, graceful shutdown with `preStop`
- PodDisruptionBudgets — protecting against voluntary disruption from node maintenance or autoscaling, not just your own deploys
- Resource requests/limits and QoS classes — the single highest-leverage production setting, with guidance on picking real numbers instead of guessing
- EKS-specific configuration: Node Groups vs Karpenter, IAM Roles for Service Accounts (IRSA), the AWS Load Balancer Controller, and how bad resource requests directly translate into AWS billing

### [`networking.md`](./networking.md)
Comprehensive networking — the topic most guides underexplain, split into two layers:
- **Kubernetes networking**: CNI plugins (why Cilium/eBPF is the 2026 default), Services and their types, Ingress vs. the Gateway API (including Ingress NGINX's 2026 retirement), NetworkPolicy and a real zero-trust rollout sequence that won't cause an outage, and when a service mesh is actually justified
- **AWS VPC/subnet design for EKS**: the two-VPC reality of EKS, public/private/isolated subnet patterns with real CIDR examples, the pod-IP-exhaustion gotcha and its fix (prefix delegation), NAT Gateway design, VPC Endpoints, and private/compliance-grade cluster architecture

## Suggested order

Read `docker/` first — this guide leans on Docker vocabulary (images, containers, Compose) throughout rather than re-explaining it. Once `basic.md` here makes sense, read `advanced.md` before deploying anything real, then `networking.md` once you're ready to expose a real service externally or need to reason about cluster security. `aws/` covers how managed Kubernetes (EKS) fits alongside AWS's other options more broadly.

## Status

`basic.md`, `advanced.md`, and `networking.md` are all written. A hands-on exercise (deploying the same toy app from `docker/hands-on-project` to a real local cluster, and practicing a rolling update/rollback live) is planned but not yet written.