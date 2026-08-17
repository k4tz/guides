# Kubernetes — Production Guide

Builds on `basic.md`. Covers what changes when a cluster runs real traffic: rollout strategies, resource limits, crash/error handling, and the EKS-specific pieces. Same philosophy as the rest of this project — the practical configuration that matters, not exhaustive theory.

---

## 1. Rollout Strategies — Beyond "It Rolls Out Eventually"

`basic.md` introduced Deployments as declaring desired state. In production, *how* that rollout happens — how many pods go down at once, how Kubernetes decides a new pod is actually ready — is the difference between a real zero-downtime deploy and one that merely looks like it worked.

### The two knobs that control everything

```yaml
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # how many EXTRA pods can exist during rollout
      maxUnavailable: 0    # how many pods can be missing during rollout
```

<cite index="18-1">Kubernetes' default rolling update behavior is `maxSurge: 25%`, `maxUnavailable: 25%` — meaning up to a quarter of your pods can be replaced simultaneously.</cite> That default is a reasonable speed/safety tradeoff, but it is **not** zero-downtime — up to 25% of your capacity can be missing at once.

For genuine zero-downtime: <cite index="18-2">set `maxSurge: 1` and `maxUnavailable: 0` — this always maintains full capacity, adding one new pod before removing one old pod, at the cost of a slower rollout.</cite>

This is the exact concept from `docker/hands-on.md` Step 7 (replace one container at a time, wait for healthy, move to the next) — except it's now a two-line YAML setting instead of a script you run by hand.

### Why readiness probes are not optional here

<cite index="10-1">Without a readiness probe, Kubernetes considers a pod "ready" as soon as its container process starts</cite> — not when it can actually serve traffic. If your app needs time to connect to a database or warm a cache, requests will hit it and fail during that window, even with `maxUnavailable: 0` set correctly.

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 3
```
<cite index="12-1">Combined with `maxSurge: 1`, this means Kubernetes creates one new pod, waits for it to report ready, and only then terminates one old pod</cite> — the actual mechanism behind a safe rollout, not just a label on the YAML.

### The three probe types, and when each matters

| Probe | Answers | Consequence of failure |
|---|---|---|
| **readinessProbe** | Can this pod receive traffic *right now*? | Pod pulled from Service load balancing, not restarted |
| **livenessProbe** | Is this pod still alive/functional? | Pod is restarted |
| **startupProbe** | Has this pod finished its (possibly slow) initial startup? | Blocks liveness/readiness checks until it passes, preventing a slow-starting app from being killed as if it were stuck |

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /health
    port: 3000
  failureThreshold: 30
  periodSeconds: 10   # allows up to 5 minutes to start before liveness kicks in
```
<cite index="16-1">A startup probe is specifically for slow-starting applications — it allows a generous startup window (e.g. 30 × 10 seconds = 5 minutes here) before the liveness probe begins checking</cite>, so a legitimately slow boot isn't mistaken for a crash and killed mid-startup.

### Extra safety: minReadySeconds

<cite index="16-2">`minReadySeconds` adds a delay after a pod reports ready before the rollout proceeds to the next pod — this catches problems that only appear a few seconds after startup, which a single instantaneous readiness check would miss.</cite>
```yaml
minReadySeconds: 30
```

### A complete production rollout config

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
spec:
  replicas: 3
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  minReadySeconds: 10
  progressDeadlineSeconds: 600
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: myapp
          image: myapp:1.4.0
          ports:
            - containerPort: 3000
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 15"]
```
<cite index="12-2">The `preStop` hook here delays actual shutdown briefly, giving in-flight requests time to complete and giving the Service/load balancer time to stop routing new traffic to this pod before it terminates</cite> — this is graceful shutdown, covered more in §3.

**Note the specific image tag (`myapp:1.4.0`), not `latest`** — same reasoning as `docker/advanced.md` §7: you need to know exactly what's running, and be able to `kubectl rollout undo` to a specific known-good version.

---

## 2. Rollback

Every rollout is versioned automatically:
```bash
kubectl rollout status deployment/myapp        # watch a rollout in progress
kubectl rollout history deployment/myapp        # see past revisions
kubectl rollout undo deployment/myapp           # roll back to the previous revision
kubectl rollout undo deployment/myapp --to-revision=3   # roll back to a specific one
```
This only works meaningfully if `revisionHistoryLimit` keeps enough history (default keeps 10) and images are tagged specifically rather than `latest` — otherwise "roll back" just redeploys whatever `latest` currently points to, which may not be the old version at all.

---

## 3. Crash and Error Handling

### What happens when a pod crashes

Kubernetes restarts it automatically, according to `restartPolicy` (default: `Always`). This is the self-healing behavior mentioned in `basic.md` — but repeated crashes trigger **CrashLoopBackOff**, where Kubernetes waits progressively longer between restart attempts rather than restart-looping rapidly forever.

```bash
kubectl get pods                     # CrashLoopBackOff shows here directly
kubectl describe pod <pod-name>      # shows recent events, exit codes, why it's restarting
kubectl logs <pod-name>              # current container's logs
kubectl logs <pod-name> --previous   # logs from the crashed instance BEFORE the restart — usually what you actually need
```
`--previous` is the detail people miss: once a pod restarts, `kubectl logs` shows the *new* container's (often empty) logs, not the crash itself.

### Graceful shutdown — stopping crashes from becoming dropped requests

<cite index="12-3">Without proper handling, Kubernetes' default behavior can send traffic to pods before they're ready, and — on the way down — can terminate a pod before in-flight requests finish and before it's removed from load-balancing endpoints</cite>. The `preStop` hook shown in §1 addresses the shutdown side: it delays the actual `SIGTERM`/kill briefly so the Service has time to stop routing new traffic first.
```yaml
terminationGracePeriodSeconds: 60
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 15"]
```
Your app should also listen for `SIGTERM` itself and stop accepting new connections while finishing in-flight ones — Kubernetes-side config alone isn't sufficient if the app just dies instantly on signal.

### PodDisruptionBudget — protecting against *voluntary* disruption

Rolling updates are one source of pod churn; node maintenance, cluster autoscaler scale-down, and manual `kubectl drain` are others. A **PodDisruptionBudget (PDB)** caps how many pods can be voluntarily taken down at once, regardless of the reason:
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myapp-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: myapp
```
<cite index="14-1">This tells Kubernetes to require at least this many (or this percentage) pods available before allowing a voluntary eviction to proceed</cite> — protecting you from a cluster operation (not just your own deploys) accidentally taking down too much capacity at once.

---

## 4. Resource Requests and Limits — The Highest-Leverage Production Setting

<cite index="3-1">Missing resource limits is one of the most common root causes of real production incidents</cite>, and <cite index="7-1">two of the most common incident patterns both trace back to guessed-at resource values</cite>: an OOMKilled loop from a limit set too low, or a cluster running at low utilization because requests were padded "just in case."

### Requests vs. limits — what each actually controls

<cite index="1-1">Requests influence the scheduler's node selection — if no node has enough requested capacity available, the pod stays Pending. Limits cap maximum usage, preventing one container from starving others on the same node.</cite>

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```
<cite index="7-2">CPU limits throttle the container when exceeded; memory limits get the container OOMKilled (terminated) when exceeded</cite> — this asymmetry matters: a CPU spike just slows your app down, a memory spike kills it outright.

### QoS classes — decided automatically from what you set

<cite index="3-2">Kubernetes assigns each pod a Quality of Service class based on its requests/limits: **Guaranteed** (requests equal limits — highest priority, last to be evicted), **Burstable** (requests set but lower than limits), or **BestEffort** (no requests or limits set at all — evicted first)</cite> under node resource pressure.

<cite index="7-3">Practical guidance: use Guaranteed QoS for anything that pages a human if it goes down — databases, payment services, auth. Use Burstable for ordinary web servers and workers where occasional throttling under extreme pressure is acceptable.</cite>

**Never leave requests/limits unset in production** — that's BestEffort, and it's the first thing evicted when a node runs low on resources, regardless of how important the workload actually is.

### How to actually pick the numbers, instead of guessing

<cite index="8-1">A January 2026 study of over 3,000 production clusters found 68% of pods request three to eight times more memory than they actually use</cite> — padding "just in case" is extremely common and directly costs money, since <cite index="8-2">autoscalers provision new nodes based on requested resources, not actual usage</cite>.

<cite index="5-1">Start with conservative, slightly-above-observed-average values, then monitor actual usage with tools like Prometheus/Grafana and iterate — looking at average, 90th, and 99th percentile usage over a meaningful time window,</cite> rather than picking numbers upfront and never revisiting them.

---

## 5. Namespaces and Governance at a Glance

Not deep-dived here (see `basic.md` §6 "what to skip"), but worth knowing these exist for when a cluster has more than one team/environment on it:
- **Namespaces** — logical separation (`dev`, `staging`, `production`)
- **ResourceQuota** — caps total resource usage per namespace
- **LimitRange** — enforces that every pod in a namespace *must* specify requests/limits, preventing the BestEffort problem from §4 by policy rather than by hoping everyone remembers

---

## 6. EKS-Specific Configuration

Everything above is plain Kubernetes and applies identically on EKS. What EKS adds/changes:

- **Node provisioning**: EKS pods run on EC2 instances (or Fargate) that you configure via **Node Groups** (managed) or **Karpenter** (increasingly the modern default — provisions right-sized nodes automatically based on pending pod requirements, rather than a fixed-size group)
- **IAM integration**: pods can assume AWS IAM roles directly (**IRSA** — IAM Roles for Service Accounts, or the newer **EKS Pod Identity**) instead of managing AWS credentials as Kubernetes Secrets — the secure, current-recommended way for a pod to talk to S3/RDS/etc.
- **Load balancing**: an EKS Service of `type: LoadBalancer` provisions a real AWS ALB/NLB automatically via the **AWS Load Balancer Controller** — same YAML concept as `basic.md` §5, backed by real AWS infrastructure
- **Cluster Autoscaler / Karpenter**: adds/removes EC2 nodes based on pending pod resource requests — this is precisely why §4's numbers matter on EKS specifically: bad resource requests directly translate into AWS billing via unnecessary node scale-ups

Cost reminder from `aws/basic.md`: the ~$73/month EKS control plane cost is separate from and in addition to whatever EC2/Fargate compute your pods consume.

---

## What to Skip For Now

- Custom autoscaling beyond default Horizontal Pod Autoscaler (HPA) — HPA on CPU/memory covers most needs before you need custom metrics
- Multi-cluster / multi-region Kubernetes — a large jump in complexity, same "not needed yet" reasoning as `aws/basic.md` §7
- Service meshes (Istio, Linkerd) — solve problems (fine-grained traffic routing, mTLS between services) most single-app deployments don't have yet
- Admission controllers / policy-as-code (Kyverno, OPA) — valuable once multiple teams share a cluster and you need to *enforce* the practices in this guide automatically, rather than a first-deployment concern

---

## See more

- [Kubernetes Deployments — rolling update strategy](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Configure Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Pod Disruption Budgets](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)
- [EKS Best Practices Guide](https://docs.aws.amazon.com/eks/latest/best-practices/introduction.html)
- [IAM Roles for Service Accounts (IRSA)](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)