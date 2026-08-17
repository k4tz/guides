# Kubernetes & AWS Networking — Comprehensive Guide

Builds on `basic.md` and `advanced.md`. Networking is genuinely the topic that trips up more people than any other part of Kubernetes — it spans two distinct layers that get conflated constantly:

1. **Kubernetes networking** — how pods and services talk to each other and to the outside world, regardless of what cloud you're on
2. **AWS VPC networking** — the actual network your EKS cluster's nodes live inside, which exists whether or not Kubernetes is involved at all

This guide covers both, in that order, since layer 2 is the foundation layer 1 runs on top of.

---

## Part A — Kubernetes Networking

### A1. The Four Problems Kubernetes Networking Solves

Every networking concept in Kubernetes exists to answer one of these:

| Problem | Solved by |
|---|---|
| Containers in the same Pod talking to each other | `localhost` — they share a network namespace automatically |
| Pods talking to other Pods (possibly on different nodes) | The **CNI** (Container Network Interface) plugin |
| A stable way to reach a group of pods that keeps changing | **Services** |
| External traffic reaching your cluster | **Ingress** / **Gateway API** |

### A2. Why You Never Hardcode a Pod IP

<cite index="25-1">When a pod is replaced — through scaling, an update, or a crash — the new pod gets a different IP.</cite> This is true even for a "rolling update" that's otherwise seamless from the user's perspective. This is the entire reason **Services** exist: <cite index="25-2">a Service provides a stable IP address and DNS name for a set of pods</cite>, so nothing else in your system needs to know or care that pod IPs are constantly churning underneath.

### A3. CNI — What Actually Moves the Packets

The CNI plugin is the thing that makes pod-to-pod networking physically work — Kubernetes itself doesn't implement packet routing, it delegates to whichever CNI you've installed.

<cite index="20-1">Cilium has become the dominant CNI as of 2026, with eBPF moving from experimental to production standard.</cite> <cite index="25-3">Cilium's eBPF-based approach eliminates the older kube-proxy/iptables mechanism entirely, provides kernel-level network policy enforcement, and includes built-in observability via Hubble.</cite> Real measured impact: <cite index="22-1">switching from iptables-mode kube-proxy to Cilium's eBPF replacement has been observed to reduce p99 service discovery latency from 45ms to under 2ms during peak deployment windows.</cite>

**Practical takeaway:** if you're standing up a new cluster in 2026, Cilium is the reasonable default choice over older CNIs (Calico, Flannel) unless you have a specific reason otherwise. On EKS specifically, this is configured at cluster creation — see Part B.

### A4. Services — The Three Types That Matter

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
  type: ClusterIP   # <- this line is what changes below
```

| Type | Reachable from | Use case |
|---|---|---|
| `ClusterIP` (default) | Inside the cluster only | Internal services (e.g. your backend talking to an internal auth service) |
| `NodePort` | Any node's IP, on a specific port | Rarely used directly in production — mostly a building block for other things |
| `LoadBalancer` | The public internet | Provisions a real cloud load balancer (an AWS ALB/NLB on EKS) — what we used in `basic.md` §5 |

### A5. Ingress and the Gateway API — Routing External Traffic In

A `LoadBalancer` Service works, but if you have multiple apps/routes, you don't want a separate cloud load balancer per app. **Ingress** (and its modern replacement, the **Gateway API**) let one entry point route to many services based on hostname/path.

**Important 2026 update:** <cite index="20-2">the Ingress NGINX controller — long the most common Ingress implementation — is officially retiring, and the ecosystem is migrating to the Gateway API.</cite> <cite index="20-3">The recommended path is Gateway API with an implementation matching your environment — Envoy Gateway, Istio Gateway, or Cilium Gateway (if you're already using Cilium as your CNI, its built-in Gateway API support is a natural fit).</cite>

Minimal Gateway API example:
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: myapp-gateway
spec:
  gatewayClassName: cilium   # depends on your chosen implementation
  listeners:
    - name: http
      protocol: HTTP
      port: 80
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: myapp-route
spec:
  parentRefs:
    - name: myapp-gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: myapp-service
          port: 80
```
**Practical guidance:** if you're starting fresh, learn Gateway API directly rather than classic Ingress — it's where the ecosystem is heading and classic Ingress is on its way out.

### A6. NetworkPolicy — Zero Trust Inside the Cluster

<cite index="25-4">By default, every pod in a Kubernetes cluster can talk to every other pod</cite> — no restrictions at all, regardless of namespace. <cite index="19-1">In 2026 this default-open posture is widely considered a security risk; NetworkPolicies provide a declarative way to restrict pod/namespace traffic, supporting a Zero Trust model that limits lateral movement during a security incident.</cite>

**Important gotcha:** <cite index="25-5">NetworkPolicy requires a CNI that supports it — Calico and Cilium both provide full support, but some providers' default CNI (e.g. basic kubenet) does not.</cite> Confirm your CNI supports it before writing policies you assume are being enforced.

A realistic default-deny + explicit-allow pattern, matching a typical frontend → backend → database chain:
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-backend-to-database
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: database
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: backend
      ports:
        - protocol: TCP
          port: 5432
```
<cite index="21-1">This is exactly the traffic flow you want in a production three-tier app: frontend talks to backend, backend talks to database, and frontend has no direct database access.</cite> Without an explicit policy like this, any compromised pod anywhere in the cluster could reach your database directly.

**How to roll this out without breaking things** — a real, tested sequence: <cite index="23-1">first audit existing traffic (Cilium's Hubble, or Calico's audit mode) for 24-48 hours to see what's actually talking to what. Build allow rules only for traffic you actually observed — don't guess. Apply in audit/dry-run mode first if your CNI supports it. Test in staging. Only then apply default-deny to production, during a low-traffic window, with a rollback command ready</cite> (`kubectl delete networkpolicy default-deny-ingress default-deny-egress -n production`). Going straight to default-deny in production without this audit step is how you cause an outage, not prevent one.

### A7. L7 Policy — Beyond IP/Port Rules

Standard `NetworkPolicy` only operates at L3/L4 (IP and port) — <cite index="22-2">you can allow TCP port 80, but can't distinguish a safe `GET /health` from a dangerous `POST /admin/delete` on that same port.</cite> If your CNI is Cilium, `CiliumNetworkPolicy` extends this to real L7 awareness:
```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: catalog-api-policy
spec:
  endpointSelector:
    matchLabels:
      app: catalog
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
          rules:
            http:
              - method: "GET"
```
This is genuinely advanced territory — reach for it once basic NetworkPolicy is in place and you have a specific case (e.g. "only checkout service can call the mutation endpoints") that L3/L4 rules can't express.

### A8. Service Mesh — When You Actually Need One

Not required for most single-app deployments — flagged as "skip for now" in `advanced.md`, worth revisiting briefly here since networking is where the actual decision gets made. <cite index="20-4">The service mesh landscape has matured, with Istio's Ambient mode eliminating the older per-pod sidecar overhead.</cite> <cite index="20-5">Practical guidance: if you're already on Cilium, start with its built-in mesh capabilities before reaching for a separate mesh like Istio</cite> — you may not need the extra layer at all.

---

## Part B — AWS VPC & Subnet Design for EKS

### B1. The Two-VPC Reality of EKS

<cite index="33-1">An EKS cluster actually consists of two VPCs: an AWS-managed VPC hosting the Kubernetes control plane, which doesn't appear in your account at all, and a customer-managed VPC hosting your nodes — where your containers actually run, along with things like load balancers.</cite> Everything in this section is about designing that second, customer-managed VPC.

### B2. Public vs Private Subnets — The Foundation Pattern

<cite index="28-1">The most common VPC design splits the network into public and private subnets. Public subnets hold resources that need direct internet access — load balancers, NAT gateways, bastion hosts. Private subnets hold everything else — application servers, databases, internal services.</cite> <cite index="28-2">This comes down to attack surface: a public subnet has a route to an internet gateway, so resources with public IPs there are directly reachable from the internet, subject to security group rules — fine for a load balancer, not fine for a database.</cite>

A realistic three-tier CIDR layout:
```
VPC: 10.0.0.0/16

Public subnets (ALB, NAT Gateway):
  10.0.0.0/24   (AZ-a)
  10.0.1.0/24   (AZ-b)
  10.0.2.0/24   (AZ-c)

Private subnets (nodes/pods):
  10.0.16.0/20  (AZ-a)  — 4,096 IPs
  10.0.32.0/20  (AZ-b)
  10.0.48.0/20  (AZ-c)

Isolated/DB subnets (RDS, ElastiCache — no internet route at all):
  10.0.192.0/24 (AZ-a)
  10.0.193.0/24 (AZ-b)
  10.0.194.0/24 (AZ-c)
```
<cite index="30-1">Private subnets are sized much larger than public ones deliberately, since pods (not just nodes) each consume IPs from the VPC's address space under the default AWS VPC CNI — undersizing this is one of the most common EKS networking failures.</cite>

**The recommended default:** <cite index="27-1">worker nodes should be placed in private subnets rather than the small subnets reserved for the cluster's own control-plane network interfaces, for maximal control over traffic to the nodes — the right choice for the vast majority of Kubernetes applications.</cite>

### B3. The IP Exhaustion Gotcha

This is the single most common real-world EKS networking failure, worth understanding concretely: <cite index="30-2">under the default AWS VPC CNI, each pod consumes a real IP address from the VPC's subnet — not just each node.</cite> Subnets sized for "how many EC2 instances will I run" rather than "how many pods will I run" hit exhaustion fast.

**The fix — prefix delegation:** <cite index="30-3">instead of each secondary IP slot on a node's network interface holding one IP, prefix delegation gives it a /28 block (16 IPs) instead. An m5.large, for example, can go from a handful of usable pod IPs to roughly 431 possible pod IPs across its interfaces</cite> (practical limits are usually lower due to node CPU/memory, but the IP ceiling stops being the constraint). This is a setting you enable on the VPC CNI, not something that requires redesigning your VPC.

### B4. NAT Gateway — How Private Subnets Reach the Internet

Pods in private subnets have no direct route out, by design (that's the whole point of "private"). But they still often need outbound access — pulling images, calling external APIs. A **NAT Gateway** sits in a public subnet and provides that outbound-only path: private subnet resources can initiate connections out, but nothing from the internet can initiate a connection in.

<cite index="32-1">Deploying a NAT Gateway per Availability Zone (rather than one shared NAT Gateway for the whole VPC) is the recommended pattern for highly available outbound internet access from private subnets</cite> — a single shared NAT Gateway becomes both a bottleneck and a single point of failure across zones.

**Cost note:** NAT Gateways have an hourly cost plus per-GB data processing charges — for a small/early-stage app, this can be a meaningfully large line item relative to compute cost. Worth checking current pricing before assuming "one per AZ" is the right call at small scale versus a single shared one.

### B5. VPC Endpoints — Keeping Traffic Off the Public Internet (and Off the NAT Bill)

If your pods talk to other AWS services (S3, ECR, DynamoDB, etc.), routing that traffic through a NAT Gateway out to the public internet and back is both slower and adds to your NAT data-processing bill. **VPC Endpoints** let AWS services be reached directly from inside the VPC, without ever leaving Amazon's network. Worth setting up early for at least ECR (since every node needs to pull images) and S3 if used.

### B6. Private EKS Clusters — When You Need the Extra Isolation

<cite index="29-1">A fully private EKS cluster has three characteristics: a private API endpoint reachable only from inside the VPC, private nodes with no public IPs, and no direct internet exposure at all.</cite> <cite index="29-2">This is the recommended architecture for production workloads handling sensitive data, workloads under regulatory requirements like PCI-DSS or HIPAA, or simply following the principle of least exposure</cite> — not a default for every project, but the right call once compliance or sensitivity requirements are real.

<cite index="26-1">EKS gives you endpoint access control to choose whether the Kubernetes API endpoint is reachable from the public internet, only from within your VPC, or both. Public access is the default for new clusters.</cite> <cite index="26-2">If only the public endpoint is enabled, node-to-control-plane traffic actually leaves your VPC (though stays within AWS's network) — nodes need a route to an internet gateway or NAT gateway to reach it. With both endpoints enabled, that traffic can stay entirely inside your VPC via a private connection.</cite>

### B7. A Realistic Reference Stack

Pulling Parts A and B together, <cite index="25-6">a reasonable production-ready networking stack for a managed cluster in 2026 looks like: Cilium as the CNI (installed via Helm), an Ingress or Gateway API implementation for external routing, cert-manager with Let's Encrypt for automatic HTTPS, ExternalDNS to automatically create DNS records from your routes, and NetworkPolicies for namespace/service isolation</cite> — layered on top of the VPC design from Part B.

---

## What to Skip For Now

- Multi-VPC connectivity (VPC Peering, Transit Gateway) — only relevant once you have multiple VPCs/accounts that need to talk to each other
- IPv6 subnet design — most apps are fine on IPv4 for now; revisit if you specifically hit IPv4 exhaustion at real scale
- Full service mesh (Istio) — per §A8, only once Cilium's built-in mesh capabilities genuinely aren't enough
- L7 CiliumNetworkPolicy — start with standard L3/L4 NetworkPolicy; add L7 rules only for specific, identified needs

---

## See more

- [Kubernetes Networking Concepts](https://kubernetes.io/docs/concepts/services-networking/)
- [Gateway API official docs](https://gateway-api.sigs.k8s.io/)
- [NetworkPolicy reference](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Cilium documentation](https://docs.cilium.io/)
- [EKS Best Practices — Networking](https://aws.github.io/aws-eks-best-practices/networking/subnets/)
- [Amazon EKS — VPC and Subnet Considerations](https://docs.aws.amazon.com/eks/latest/best-practices/subnets.html)
- [Amazon VPC CNI — Prefix Delegation](https://docs.aws.amazon.com/eks/latest/userguide/cni-increase-ip-addresses.html)