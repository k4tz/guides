# Git Guide

Git as a practical tool — daily commands first, then how a team actually organizes branches, releases, and hotfixes once it's not just you working solo.

## Contents

### [`basic.md`](./basic.md)
Start here. Covers:
- Installing git and the one-time `user.name`/`user.email` setup
- The core mental model — working directory, staging area, repository, and how a change moves through all three
- Why nothing syncs automatically, and why "I committed but they can't see it" is almost always a missing push
- The daily loop: `status`/`add`/`commit`/`log`
- Branching and merging day-to-day, including what a merge conflict actually is and how to resolve one
- Remotes: `push`/`pull`/`fetch`, and the difference between the last two
- Undoing things — `restore`, `amend`, `reset` vs `revert`
- `.gitignore`, and cloning/contributing to someone else's repo via a pull request
- A "starter kit" of commands to memorize

### [`advanced.md`](./advanced.md)
Branching strategies and team workflow. Covers:
- Three branching strategies — trunk-based, GitFlow, GitHub Flow — with real branch diagrams and worked commands for each, plus how to pick one
- Tags — lightweight vs annotated, Semantic Versioning, and checking out a tag safely (detached HEAD)
- Releases — the distinction between a tag (git-native) and a release (hosting-platform feature built on top of one), and generating a changelog from tagged commit ranges
- Hotfixes — patching production correctly under each branching strategy, including the "forgot to merge back into develop" trap, and patching an older still-supported version by branching off a tag instead of `main`
- Rebasing — what it actually does differently from merge, and the one rule that matters about never rebasing shared history
- Team norms: Conventional Commits, branch naming, and protecting `main`
- A scope note throughout: this guide covers the git-side conventions; what actually triggers off a tag push or a merge is CI/CD, a separate layer

## Suggested order

`basic.md` first — the daily loop and branching/merging need to be comfortable before the strategies in `advanced.md` mean anything concrete. Read `advanced.md` once you're either working on a team repo or about to set one up, not before.