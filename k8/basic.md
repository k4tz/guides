# Kubernetes Basics — A Practical Guide

Builds directly on the `docker/` guide — assumes you're comfortable with images, containers, and Compose. This guide answers the question that closes out `docker/advanced.md`: **what actually automates the manual stuff (health-watching, staggered rollouts, restarts, scaling) we were scripting by hand?**

Same philosophy as the Docker guides: the tool, not the internals. No etcd, no control-plane architecture deep-dives — just enough to get a cluster running locally and deploy something real to it.

---

## 1. Install

Kubernetes needs three separate pieces, not one installer:

1. **A container runtime** — you already have this: Docker Desktop.
2. **`kubectl`** — the CLI you'll actually type commands into. This is the `docker` CLI equivalent.
3. **A local cluster** — Kubernetes is designed to run across multiple machines, so for learning on one laptop you need something that fakes a cluster locally.

### kubectl

Docker Desktop can install `kubectl` for you (Settings → Kubernetes → Enable), or install standalone:
```bash
# Windows (via winget)
winget install -e --id Kubernetes.kubectl

# Verify
kubectl version --client
```

### Local cluster — Minikube

Several tools exist (Minikube, Kind, k3d) — this guide uses **Minikube**, the standard choice for learning, since it gives a production-like environment with extras like a dashboard and add-ons out of the box. Kind and k3d are worth knowing about later — they're leaner and better suited to CI pipelines — but Minikube is the friendlier starting point.

```bash
# Windows (via winget)
winget install Kubernetes.minikube

# Start a local cluster (uses Docker as the driver by default)
minikube start

# Verify
kubectl get nodes
```
You should see one node listed with status `Ready` — that single node **is** your entire local cluster, standing in for what would be many physical machines in real production.

---

## 2. Mental Model — What Changes vs Plain Docker

| Docker/Compose concept | Kubernetes equivalent | What's different |
|---|---|---|
| Container | **Pod** | A pod usually wraps one container (sometimes more), but it's the smallest unit Kubernetes schedules — you rarely talk to containers directly anymore |
| `docker run` | **Deployment** | You don't create pods directly — you declare a Deployment (desired state: "I want 3 of these, always"), and Kubernetes creates/maintains the pods to match |
| One Docker host | **Cluster** (multiple **Nodes**) | Pods get scheduled across however many machines are in the cluster, not confined to one host |
| nginx container you configured by hand | **Service** | Built-in load balancing and stable networking to reach a group of pods, without you writing nginx config yourself |
| `docker-compose.yml` | Kubernetes **manifests** (YAML) | Similar spirit — declarative config — but split across multiple files/kinds (Deployment, Service, etc.) rather than one Compose file |
| You watching `docker compose ps` for health | **Controller loop** | Kubernetes continuously watches actual vs desired state, forever, and corrects drift automatically — this is the core idea the whole system is built around |

### The one idea that explains most of Kubernetes

You declare **desired state** ("I want 3 healthy replicas of this image running") and Kubernetes' controllers continuously work to make reality match that, forever — restarting crashed pods, rescheduling if a node dies, rolling out updates you declare. This is fundamentally different from Docker/Compose, where you're issuing one-off imperative commands (`docker run`, `docker stop`) that Docker executes once and then forgets about.

---

## 3. Core Objects You'll Actually Use

### Pod
The smallest deployable unit — one or more containers sharing network/storage. You rarely create these directly; a Deployment creates them for you.

### Deployment
Declares: this image, this many replicas, this update strategy. This is the K8s equivalent of what we scripted by hand in `docker/hands-on.md` Step 7 (build → stagger → replace → verify healthy) — except declared once, and Kubernetes executes and maintains it continuously.

### Service
Gives a stable network identity to a group of pods and load-balances across them — the built-in replacement for the nginx `upstream` block we hand-wrote in the Docker hands-on project.

### Namespace
A way to partition a cluster into logical groups (e.g. `dev`, `staging`, `prod`) — not covered in depth here, just good to recognize the term.

---

## 4. Core Commands

```bash
kubectl get nodes                    # list nodes in the cluster
kubectl get pods                     # list pods
kubectl get deployments              # list deployments
kubectl get services                 # list services

kubectl apply -f myapp-deployment.yaml   # create/update from a manifest file
kubectl delete -f myapp-deployment.yaml  # remove what that manifest created

kubectl describe pod <pod-name>      # detailed info + recent events — first stop when debugging
kubectl logs <pod-name>              # view logs from a pod
kubectl logs -f <pod-name>           # follow logs live

kubectl exec -it <pod-name> -- bash  # shell inside a running pod (like docker exec)

kubectl scale deployment myapp --replicas=5   # change replica count on the fly
```

Notice the shape: almost everything reads as either **apply a declared state** (`apply -f`) or **inspect current state** (`get`, `describe`, `logs`) — there's no direct "start/stop a pod" the way there was `docker start/stop`. You change the desired state and let Kubernetes reconcile it.

---

## 5. A Minimal Deployment + Service

`deployment.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:1.0.0
          ports:
            - containerPort: 3000
```

`service.yaml`
```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
spec:
  selector:
    app: myapp
  ports:
    - port: 80
      targetPort: 3000
  type: LoadBalancer
```

Apply both:
```bash
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
```

This single declaration is doing what our entire `docker-compose.yml` + `nginx.conf` pair did — 3 replicas, load-balanced, addressable by one stable name (`myapp-service`) — except Kubernetes also now watches this continuously and will replace any pod that crashes, without you noticing or intervening.

---

## 6. Getting Config and Secrets Out of Your Image

So far `image: myapp:1.0.0` in the Deployment is the only place configuration comes from. That's fine for a fixed image, but real apps need environment-specific values (a database URL for `dev` vs `prod`) and sensitive values (API keys, passwords) — and you don't want either baked into the image or pasted directly into a Deployment YAML that gets committed to git.

Kubernetes has two primitives for exactly this split:

| Primitive | For | Stored as |
|---|---|---|
| **ConfigMap** | Non-sensitive config — URLs, feature flags, log levels | Plain text |
| **Secret** | Sensitive values — passwords, tokens, keys | Base64-encoded (**not encrypted** — see note below) |

They're used the same way in a Deployment; the difference is entirely in what you put in them and how the cluster treats them.

### ConfigMap

```bash
# Quick way — from literal values
kubectl create configmap myapp-config \
  --from-literal=LOG_LEVEL=info \
  --from-literal=API_BASE_URL=https://api.example.com
```
or declaratively (the version you'd actually commit to git):
```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
data:
  LOG_LEVEL: "info"
  API_BASE_URL: "https://api.example.com"
```

### Secret

```bash
# Quick way — kubectl handles the base64 encoding for you
kubectl create secret generic myapp-secrets \
  --from-literal=DB_PASSWORD=supersecret \
  --from-literal=API_KEY=sk_live_abc123
```
The declarative version requires the values pre-encoded, which is exactly why you almost never hand-write Secret YAML directly:
```yaml
# secret.yaml — DO NOT commit this file with real values
apiVersion: v1
kind: Secret
metadata:
  name: myapp-secrets
type: Opaque
data:
  DB_PASSWORD: c3VwZXJzZWNyZXQ=   # base64, NOT encryption
```

**Important:** base64 is an encoding, not encryption — anyone with `kubectl get secret myapp-secrets -o yaml` and a terminal can decode it in one command (`echo <value> | base64 -d`). Kubernetes Secrets give you *separation from your app config* and *RBAC-controlled access*, not real secrecy at rest by default. For actual production secret management, see `advanced.md`'s Helm section and look into a dedicated secrets manager (AWS Secrets Manager, External Secrets Operator) or encryption-at-rest for etcd — out of scope here, but know the gap exists before treating a Secret object as sufficient on its own.

### Using both in a Deployment

```yaml
spec:
  containers:
    - name: myapp
      image: myapp:1.0.0
      envFrom:
        - configMapRef:
            name: myapp-config      # every key in the ConfigMap becomes an env var
        - secretRef:
            name: myapp-secrets     # every key in the Secret becomes an env var
      env:
        - name: DB_PASSWORD          # or reference a single key explicitly
          valueFrom:
            secretKeyRef:
              name: myapp-secrets
              key: DB_PASSWORD
```
`envFrom` is the fast path (dump everything in as env vars); a single `valueFrom` reference is more explicit when you only need one or two specific keys, or want the env var name to differ from the key name.

Apply all three together:
```bash
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml
kubectl apply -f deployment.yaml
```

---

## 7. What to Skip For Now

- Multi-node cluster setup (real clusters, cloud providers) — Minikube's single node is enough to learn the concepts
- Helm (a package manager for Kubernetes manifests) — useful once your YAML sprawls across many files; covered in `advanced.md` once you have enough manifests to feel that pain
- Persistent Volumes / StatefulSets — needed for stateful apps (databases); skip until you actually need one
- Ingress controllers — the "real" equivalent of external-facing nginx; `type: LoadBalancer` is enough to start. Covered with a concrete example in `networking.md`
- RBAC, network policies — cluster security/access-control, relevant once multiple people/teams share a cluster
- Custom Resource Definitions (CRDs), Operators — advanced extension mechanisms, not needed to be productive
- Encrypting Secrets at rest / external secrets managers — §6 above flags this gap deliberately; revisit once you're handling real production credentials

---

## See more

- [Kubernetes official docs](https://kubernetes.io/docs/home/)
- [kubectl reference](https://kubernetes.io/docs/reference/kubectl/)
- [Minikube docs](https://minikube.sigs.k8s.io/docs/)
- [Kubernetes concepts overview](https://kubernetes.io/docs/concepts/)