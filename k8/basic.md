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

## 6. What to Skip For Now

- Multi-node cluster setup (real clusters, cloud providers) — Minikube's single node is enough to learn the concepts
- Helm (a package manager for Kubernetes manifests) — useful once your YAML sprawls across many files
- Persistent Volumes / StatefulSets — needed for stateful apps (databases); skip until you actually need one
- Ingress controllers — the "real" equivalent of external-facing nginx; `type: LoadBalancer` is enough to start
- RBAC, network policies — cluster security/access-control, relevant once multiple people/teams share a cluster
- Custom Resource Definitions (CRDs), Operators — advanced extension mechanisms, not needed to be productive

---

## See more

- [Kubernetes official docs](https://kubernetes.io/docs/home/)
- [kubectl reference](https://kubernetes.io/docs/reference/kubectl/)
- [Minikube docs](https://minikube.sigs.k8s.io/docs/)
- [Kubernetes concepts overview](https://kubernetes.io/docs/concepts/)
