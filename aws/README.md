# AWS Guide

A practical guide to AWS's hosting and deployment options — not a general AWS tour, just the specific decision of "where does my app actually run, and which option fits my situation." Stands on its own, though it's most useful once you already have an app packaged as a container image.

## Contents

### [`basic.md`](./basic.md)
Start here. Covers:
- The core idea: AWS's compute options (EC2, ECS, Fargate, EKS) are a ladder of abstraction — every option ultimately runs containers on machines somewhere, they differ in how much of that machinery *you* manage vs. AWS
- Each option explained plainly, including a note on **AWS App Runner's 2026 move to maintenance mode** and its replacement, **ECS Express Mode**
- A classification table comparing scale ceiling, operational complexity, relative cost, and ease of getting started
- Why "global traffic" is a separate problem from compute choice — CDN/DNS/multi-region, not which compute service you pick
- A fully worked example: sizing a real deployment for a niche platform with ~100k users and global-ish traffic
- An optional cross-reference table for readers coming from this project's `docker/`/`k8s/` guides, mapping familiar concepts (Docker Hub, Compose, rolling updates) to their AWS equivalents
- What to deliberately skip for now (multi-region, EKS unless you need it, deep IAM/VPC work, cost-optimization tooling)

## Suggested order

Usable standalone if you already know what a container image is. If you're coming from this project's other guides, read `docker/` first (and optionally `k8s/`) — §6 of `basic.md` here is specifically for you and maps the vocabulary directly.

## Status

This guide currently covers the compute/hosting decision only (`basic.md`). An advanced/practical follow-up (actual ECR push commands, a real ECS Task Definition, wiring a CI/CD pipeline step to trigger a deploy) is planned but not yet written — see the `cicd/` guide for the pipeline side of that in the meantime.