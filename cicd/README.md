# CI/CD Guide

CI/CD as the layer that sits on top of everything else in this series — the automation that actually turns a git push into tests running, an image building, and a new version live in production. Ties `git/`, `docker/`, `aws/`, and `k8/` together into one working pipeline.

## Contents

### [`basic.md`](./basic.md)
Start here. Covers:
- What CI/CD actually is, and why the trigger is always a git event, not a schedule
- The core vocabulary — pipeline, stage, job, step, runner, artifact — and how they nest
- Why the right platform is almost always "wherever your code already lives" (this guide uses GitHub Actions throughout)
- A real, minimal pipeline for a Node app — test on every push, build the Docker image only if tests pass — read line by line
- Secrets: why they never belong in the pipeline YAML, and the platform's encrypted secrets store instead
- Caching dependencies between runs, and why it's needed at all (every run starts from a disposable, empty machine)
- Artifacts — passing files between jobs that don't otherwise share anything
- A "starter kit" mental checklist for scoping out any new pipeline

### [`advanced.md`](./advanced.md)
Deployment strategies and a full production pipeline. Covers:
- Environments — why staging and production shouldn't be deployed to the same way, and approval gates as a platform feature
- Three deployment strategies — rolling, blue-green, canary — with the trade-offs of each and how to pick one
- Rollbacks, and why a rollback should be at least as automated as the deploy itself
- A complete, real worked pipeline: build → push to AWS ECR → deploy to ECS, triggered by a version tag — including a real ECS Task Definition and using OIDC instead of a long-lived AWS key. This is the pipeline `aws/README.md` names directly as its planned follow-up.
- A quick reference table: what changes between a first pipeline and a production-ready one

## Suggested order

Read `git/`, `docker/`, and at least `aws/basic.md` first — this guide assumes all three and spends its entire second half wiring them together rather than re-explaining any of them. `basic.md` here first, then `advanced.md` once you have somewhere real to deploy to.