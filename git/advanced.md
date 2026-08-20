# Git — Branching Strategies & Team Workflow Guide

Builds on `basic.md`. This covers what changes when git stops being "just you" and becomes a team's shared history: branching strategies, tags, releases, hotfixes, and the norms that keep a shared repo sane instead of a mess of conflicting history.

**Scope note:** this is Git subject matter specifically — the conventions for organizing branches, commits, and releases. What actually *triggers* off a tag push or a merge to `main` (running tests, building an image, deploying) is CI/CD, a separate layer that sits on top of these conventions rather than being part of git itself.

---

## 1. Branching Strategies — Why They Exist

`basic.md` covered branching mechanically. The open question a team has to answer is: **which branches exist, what's each one for, and when does code move between them?** A branching strategy is just an agreed answer to that, written down so everyone follows the same pattern instead of improvising.

There's no single correct answer — the right strategy depends on team size, release cadence, and how many versions you need to support simultaneously.

### Trunk-Based Development

One long-lived branch (`main`), short-lived feature branches (hours to a couple days), merged back frequently.

```
main:     A---B---C---D---E---F
               \     /   \   /
feature:        b1--b2    c1-c2
```

```bash
git switch -c feature/add-search
# small, fast changes
git push -u origin feature/add-search
# open PR, merge same day or next
```

**Best for:** teams practicing continuous deployment, where `main` is always releasable and every merge can ship. **Trade-off:** requires strong test coverage and CI, since there's no long-lived "staging" branch to catch problems before they reach `main`.

### GitFlow

Two long-lived branches (`main` = production, `develop` = integration), plus short-lived `feature/`, `release/`, and `hotfix/` branches around them.

```
main:      ----------------------M1-------------------M2----
                                 /                    /
release:                  R1----                R2---
                          /                      /
develop:   D--D--D--D--D-------D--D--D--D--D---
               \  /                \  /
feature:       f1                  f2
```

```bash
git switch -c feature/user-profiles develop    # feature branches off develop
# ...work...
git switch develop
git merge feature/user-profiles

# when develop is ready to ship:
git switch -c release/2.4.0 develop            # release branch for final testing/fixes
# ...bugfixes only, no new features, on this branch...
git switch main
git merge release/2.4.0
git tag v2.4.0
git switch develop
git merge release/2.4.0                         # bring release fixes back into develop too
```

**Best for:** teams shipping distinct, versioned releases (desktop software, mobile apps, anything with a release cadence slower than "constantly"). **Trade-off:** meaningfully more overhead than trunk-based — more branches to keep in sync, more chances for `develop` and `main` to drift apart if a step is missed.

### GitHub Flow

The middle ground: one long-lived `main`, feature branches, but merges go through a pull request and deploy right after merging — no `develop`, no `release/` branches.

```bash
git switch -c feature/checkout-redesign
# ...work, push, open PR...
# PR reviewed, CI passes, merge to main
# main auto-deploys (this part is CI/CD, not git)
```

**Best for:** web apps and services deployed continuously, where you want PR review as a gate but don't need GitFlow's full ceremony. This is the most common default for small-to-mid teams today.

### Picking one

| If your situation is... | Lean toward... |
|---|---|
| Small team, continuous deploy, web app/API | Trunk-based or GitHub Flow |
| Need PR review as a gate, but simple release model | GitHub Flow |
| Multiple supported versions at once, scheduled releases | GitFlow |
| Open source project, many external contributors | GitHub Flow (PR-centric, easy for outsiders to understand) |

---

## 2. Tags — Marking a Specific Commit as "This Is a Release"

A branch moves forward every commit. A **tag** doesn't — it's a fixed pointer to one specific commit, forever. That permanence is exactly what you want for marking "this exact commit is what we shipped as v2.4.0."

```bash
git tag v2.4.0                          # lightweight tag — just a name pointing at the current commit
git tag -a v2.4.0 -m "Release 2.4.0"     # annotated tag — includes message, author, date (use this for releases)

git tag                                   # list all tags
git push origin v2.4.0                    # tags don't push automatically — must be pushed explicitly
git push origin --tags                    # push all local tags at once
```

**Annotated vs lightweight:** use annotated (`-a`) for anything you'll refer back to — it's a real object in git's history with its own metadata, not just a label. Lightweight tags are fine for quick personal markers, not for release points other people rely on.

### Semantic Versioning — the convention almost everyone uses for tags

`MAJOR.MINOR.PATCH` — e.g. `v2.4.1`:
- **MAJOR** — breaking changes, incompatible with previous versions
- **MINOR** — new functionality, backward-compatible
- **PATCH** — bug fixes only, backward-compatible

This convention is what makes a tag name meaningful at a glance — `v2.4.1` tells you "patch release on top of 2.4" before you read a single changelog line.

### Checking out a tag

```bash
git checkout v2.4.0
```
This puts you in a **detached HEAD** state — you're looking at that exact commit, but not "on" any branch. Fine for inspecting old code; if you need to make changes from this point, branch off it first (`git switch -c fix-from-2.4.0`), don't commit directly in detached HEAD, or your commits become hard to find later.

---

## 3. Releases

A tag marks a commit. A **release** (GitHub/GitLab's term) is a tag plus packaging around it — release notes, attached build artifacts, a changelog. The tag is the git-native part; the rest is a hosting-platform feature layered on top.

```bash
git tag -a v2.4.0 -m "Release 2.4.0"
git push origin v2.4.0
```
From here, creating the actual "Release" (with notes, binaries, etc.) happens on GitHub/GitLab's UI or CLI (`gh release create v2.4.0`) — pointed at the tag you just pushed. The tag is what git tracks; the release page is what humans read.

### Where the changelog comes from

```bash
git log v2.3.0..v2.4.0 --oneline
```
This shows every commit between two tags — the raw material a changelog is built from. This is also the single best argument for writing meaningful commit messages back in `basic.md` §4: a release built from ten commits all named "fix" produces a useless changelog no matter how good your release process is.

---

## 4. Hotfixes — Patching Production Without Waiting for the Next Release

A hotfix is a branch off a *specific point in history* — usually the exact commit currently in production — not off your team's regular in-progress work. The point is isolation: fix the one thing, ship it, without accidentally including unrelated half-finished changes that happen to be sitting on `develop` or `main` right now.

### On GitFlow

```bash
git switch -c hotfix/critical-auth-bug main    # branch off main (production), not develop
# fix the bug
git add .
git commit -m "fix: patch auth bypass vulnerability"

git switch main
git merge hotfix/critical-auth-bug
git tag v2.4.1
git push origin main --tags

git switch develop                              # critical: bring the fix into develop too
git merge hotfix/critical-auth-bug
git push origin develop
```
That last merge into `develop` is the step people forget under pressure — skip it, and the next regular release accidentally reverts the hotfix, because `develop` never had the fix in the first place.

### On trunk-based / GitHub Flow

Simpler, because there's no `develop` to keep in sync:
```bash
git switch -c hotfix/critical-auth-bug main
# fix, commit, push, PR, merge to main like any other change — just prioritized and fast-tracked
```

### Hotfixing an older, still-supported version

If v2.4.x is in production but you're already deep into v3.0 work on `main`, you can't branch off current `main` — it has months of unrelated changes. Branch off the *tag*:
```bash
git switch -c hotfix/2.4.2 v2.4.0     # branch from the exact tagged commit, not main
# fix, commit
git tag v2.4.2
git push origin hotfix/2.4.2 --tags
```
This is precisely why tags matter beyond "marking a release" — they're the anchor point that lets you patch an old version without disturbing current work.

---

## 5. Rebasing — When and Why

Flagged as "skip for now" in `basic.md`. The core difference from merge:

```bash
git switch feature/login-page
git rebase main
```
**Merge** creates a new commit joining two histories together — both branches' commit history stays exactly as it happened. **Rebase** replays your branch's commits one by one on top of the target branch — the result looks like you'd started your branch from the latest `main`, even though you didn't. History becomes linear, but it's a *rewritten* linear, not the literal sequence of events.

### The one rule that matters

**Never rebase a branch other people are also working on or have already pulled.** Rebasing rewrites commit hashes — everyone who already has the old commits now has history that's diverged from yours in a way `git pull` can't cleanly reconcile. This is the direct extension of `basic.md` §7's `reset` vs `revert` distinction: rebase is `reset`-like history rewriting, applied to a whole branch instead of one commit — safe on a private feature branch only you use, dangerous on anything shared.

```bash
git pull --rebase origin main    # common safe use — replays YOUR unpushed local commits on top of the latest remote main, before you've shared them with anyone
```

---

## 6. Commit and Branch Norms Worth Adopting

None of these are enforced by git itself — they're team conventions, same category as a branching strategy.

### Conventional Commits

A lightweight structure for commit messages that makes the log (and changelog generation, §3) actually parseable:
```
feat: add user search endpoint
fix: correct off-by-one error in pagination
docs: update API auth section
chore: bump dependency versions
```
`feat`/`fix` prefixes are also what many changelog-generation and semantic-versioning tools key off automatically — a `feat:` commit implies a MINOR bump, `fix:` implies PATCH, by convention.

### Branch naming

```
feature/short-description
fix/short-description
hotfix/short-description
release/2.4.0
```
Consistent prefixes make `git branch` output scannable at a glance and are often what CI config matches against (e.g. "run the full test suite on anything under `release/*`") — another point where a git-side convention becomes the thing CI/CD is built to react to.

### Protecting `main`

A hosting-platform feature (GitHub/GitLab "branch protection"), not raw git, but the practical companion to any strategy above: require PRs (no direct pushes), require passing CI checks, require at least one review, before a merge to `main` is allowed. Without this, "we use GitHub Flow" is a suggestion nobody's forced to follow.

---

## 7. What to Skip For Now

- Interactive rebase (`git rebase -i`) for squashing/reordering commits — useful for cleaning up a branch's history before merging, not needed to function day-to-day
- Cherry-picking (`git cherry-pick`) — grabbing a single specific commit onto another branch; useful occasionally, not a core workflow habit
- Submodules and monorepo tooling — separate problem space, only relevant at a specific scale/structure
- Git hooks (pre-commit, pre-push) — genuinely useful, but the natural home for this is where it meets CI/CD, not here
- Signing commits/tags (GPG/SSH signing) — relevant for supply-chain security on larger or public projects, not a first-team-workflow concern

---

## See more

- [Git branching model (the original GitFlow post)](https://nvie.com/posts/a-successful-git-branching-model/)
- [GitHub Flow guide](https://docs.github.com/en/get-started/using-github/github-flow)
- [Trunk Based Development](https://trunkbaseddevelopment.com/)
- [Semantic Versioning spec](https://semver.org/)
- [Conventional Commits spec](https://www.conventionalcommits.org/)
- [git-tag reference](https://git-scm.com/docs/git-tag)
- [git-rebase reference](https://git-scm.com/docs/git-rebase)