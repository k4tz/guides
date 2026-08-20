# Git Basics — A Practical Guide

Just the tool, no internals. No object model deep-dive, no plumbing vs porcelain — just enough to work on a real project daily without getting stuck.

---

## 1. Install

```bash
# Windows (via winget)
winget install --id Git.Git -e --source winget

# Verify
git --version
```

One-time setup (do this before your first commit):
```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

---

## 2. Mental Model

| Concept | What it is |
|---|---|
| **Repository (repo)** | A project folder git is tracking — the `.git/` folder inside it holds the entire history |
| **Commit** | A saved snapshot of the whole project at a point in time, with a message and a unique hash |
| **Branch** | A movable pointer to a commit — "the tip of this line of work" |
| **Remote** | A copy of the repo hosted elsewhere (GitHub, GitLab) that your local repo can sync with |
| **Working directory** | The actual files on disk, as you're editing them right now |
| **Staging area (index)** | The "about to be in the next commit" holding area — you choose what goes here before committing |

### The three areas, and how a change moves through them

```
Working Directory  --git add-->  Staging Area  --git commit-->  Repository (history)
```
You edit a file (working directory). `git add` marks it as ready for the next snapshot (staging). `git commit` actually takes the snapshot (history). This two-step add-then-commit is deliberate — it lets you commit only *some* of your changes, not everything you've touched.

### Local vs remote — nothing syncs automatically

Unlike a cloud-synced folder, git does **nothing** automatically. Your commits live only on your machine until you explicitly `git push` them. Someone else's commits don't appear on your machine until you explicitly `git pull`. This is the single most common source of confusion for people new to git — "I committed but my teammate can't see it" almost always means the push step didn't happen.

### A branch is just a label, not a copy

A branch isn't a separate folder or a duplicated set of files — it's a lightweight pointer to a specific commit. `git switch` (or the older `git checkout`) just moves which commit your working directory reflects. This is why branching in git is fast and cheap compared to, say, copy-pasting a project folder.

---

## 3. Starting a Repo

```bash
git init                              # start tracking the current folder
git clone https://github.com/user/repo.git   # copy down an existing remote repo
```
`clone` also automatically sets up the remote connection (called `origin`) — `init` does not, since there's no remote yet to connect to.

---

## 4. The Daily Loop — status / add / commit

```bash
git status                  # what's changed, what's staged, what's not — check this constantly
git add file.js              # stage one file
git add .                    # stage everything changed in the current folder and below
git commit -m "message"      # snapshot what's staged, with a message
```

A good commit message describes *why*, not just *what* — "fix login redirect loop" beats "fix bug." Future-you (and teammates) will read these far more often than you'd expect.

```bash
git log                      # full commit history
git log --oneline            # condensed, one line per commit — usually what you actually want
```

---

## 5. Branching — day-to-day

```bash
git branch                          # list local branches, * marks the current one
git switch -c feature/login-page    # create AND switch to a new branch, in one step
git switch main                     # switch to an existing branch
git branch -d feature/login-page    # delete a branch (only if it's already merged in)
```

### Why branch at all

The `main` branch (sometimes `master` in older repos) should generally stay in a working state. Branching lets you work on something risky or half-finished without touching that stable line — you only bring your changes into `main` once they're ready, via a merge.

### Merging

```bash
git switch main                    # go to the branch you want to merge INTO
git merge feature/login-page       # bring feature/login-page's commits into main
```

### Merge conflicts — what's actually happening

A conflict means git found a change on both branches to the *same lines* of the *same file* and can't automatically decide which one wins. Git pauses and marks the file:
```
<<<<<<< HEAD
your version of the line
=======
their version of the line
>>>>>>> feature/login-page
```
You manually edit the file to keep whichever version (or a combination) is correct, delete the `<<<<<<<`/`=======`/`>>>>>>>` markers, then:
```bash
git add file.js          # mark the conflict as resolved
git commit                # completes the merge (a merge commit is created automatically)
```
This isn't a git failure — it's git correctly refusing to guess when it genuinely can't tell which change should win.

---

## 6. Remotes — push / pull / fetch

```bash
git remote -v                   # show configured remotes (usually just "origin")
git push origin main             # send your local commits on main to the remote
git pull origin main              # fetch + merge remote changes into your current branch, in one step
git fetch origin                  # download remote changes WITHOUT merging them in yet
```

**`fetch` vs `pull`:** `fetch` just updates your knowledge of what's on the remote (safe, non-destructive, doesn't touch your working directory). `pull` is `fetch` immediately followed by a `merge` into your current branch. If you want to look before you leap — see what changed before it touches your files — `fetch` first, then decide.

### Pushing a new branch for the first time

```bash
git push -u origin feature/login-page
```
The `-u` (`--set-upstream`) links your local branch to a remote branch of the same name — after this once, plain `git push`/`git pull` on this branch know where to go without repeating `origin feature/login-page` every time.

---

## 7. Undoing Things — the situations you'll actually hit

```bash
git restore file.js                      # discard uncommitted changes to a file, back to last commit
git restore --staged file.js              # unstage a file (keeps the edits, just un-stages them)
git commit --amend -m "new message"       # fix the most recent commit's message (or add forgotten files)
git reset --soft HEAD~1                    # undo the last commit, keep the changes staged
git revert <commit-hash>                    # undo a commit by creating a NEW commit that reverses it
```

**`reset` vs `revert` — the distinction that matters:** `reset` rewrites history (the commit is gone, as if it never happened) — fine for commits that only exist locally and haven't been pushed. `revert` adds a new commit that undoes an old one, leaving the original commit intact in history — the correct choice once something has been pushed and others might already have it, since rewriting shared history causes real problems for anyone who already pulled it (see `advanced.md`).

---

## 8. Ignoring Files

`.gitignore` in the repo root — same idea as `.dockerignore` if you've used Docker:
```
node_modules/
.env
*.log
dist/
```
Files matching these patterns are never tracked, never show up in `git status`, never get accidentally committed. Set this up *before* your first commit where possible — untracking a file that's already been committed takes an extra step (`git rm --cached <file>`).

---

## 9. Cloning Someone Else's Repo and Contributing

```bash
git clone https://github.com/user/repo.git
cd repo
git switch -c my-fix
# make changes
git add .
git commit -m "fix typo in README"
git push -u origin my-fix
```
Then open a **pull request** (GitHub's term for "please merge my branch into yours") on the hosting site itself — this last step is a hosting-platform feature, not a raw `git` command.

---

## 10. What to Skip For Now

- Rebasing (`git rebase`) — a real tool, but easy to cause damage with before you're solid on merge; covered in `advanced.md`
- Interactive rebase, squashing, cherry-picking — history-rewriting tools worth knowing once branching/merging is second nature
- Submodules — for nesting one git repo inside another; rare unless you specifically need it
- Git hooks — scripts that run automatically on commit/push; a CI/CD-adjacent topic, not core daily git
- The `.git` internals (objects, refs, the object database) — genuinely not needed to be productive day to day

---

## Starter Kit — commands to memorize

```
git status
git add . / git add file
git commit -m "message"
git switch -c branch-name / git switch branch-name
git merge branch-name
git push origin branch-name / git pull origin branch-name
git log --oneline
git restore file
```

---

## See more

- [Git official docs](https://git-scm.com/doc)
- [Git install guide (all platforms)](https://git-scm.com/downloads)
- [Pro Git book (free)](https://git-scm.com/book/en/v2) — the standard deep-dive reference once you want the internals
- [GitHub's guide to pull requests](https://docs.github.com/en/pull-requests)