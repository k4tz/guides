# Guide-Creation Playbook

A reusable process for building a new technical guide (for the `k4tz/guides`-style repo), portable across different AI agents/sessions. Follow this top to bottom for any new topic.

## 1. Fixed structure — don't deviate

Every guide is four things:

```
<topic>/
├── README.md          — what this guide covers, links to the 3 files below
├── basic.md            — 90% coverage: install, mental model, common patterns
├── advanced.md          — production concepts, best practices, the "checklist"
├── hands-on.md          — walkthrough of a runnable exercise
└── hands-on-project/    — the actual runnable code the walkthrough refers to
```

Why this rigidity is good, not limiting: consistency across guides means once someone (you, or anyone else) knows how one guide is organized, they know how all of them are — no re-learning navigation per topic. Don't invent a different shape for a topic that "feels different" — reframe the topic to fit the shape instead.

## 2. Before writing anything: scope it with the person

Don't guess at scope — ask. Specifically pin down, before generating files:

- **What stack/language** for the hands-on examples (don't assume — e.g. "Python" vs "Node" vs "both" changes the whole hands-on project).
- **What real-world scenario** the hands-on project should center on. Pick something widely applicable (a scenario the person will recognize from actual work), not a toy example chosen for simplicity alone. A believable, realistic scenario is what makes the patterns transfer later.
- **What's the actual goal** — pure conceptual understanding, practical on-the-job use, interview-readiness, or some mix. This changes how much depth `advanced.md` needs and what "done" looks like.
- **Any dependency choices** that would otherwise require assumptions (e.g., "real DB via an ORM" vs "in-memory fake" for a hands-on project) — ask rather than pick silently, since this materially changes what the exercise teaches.

Use a short multiple-choice-style check-in for this rather than a long open question — it's faster for the person to answer and forces you to have already thought through the real options.

## 3. Writing `basic.md`

- Open with **why this tool/concept exists at all** — what problem it solves, what you'd do without it. This is the hook that makes the rest make sense.
- Give **the core mental model** as early as possible, ideally as a simple diagram/flow (text-based is fine: `A → B → C`). Everything else in the doc should be explainable as "a variation on this diagram."
- Cover **installation** concretely — real commands, not "refer to the docs."
- Then cover the **2-4 patterns that cover ~90% of real usage**. Not exhaustive API coverage — the load-bearing patterns people actually reach for.
- Every concept gets a **runnable code snippet**, not just prose description.
- Close with a short "what you can do now" recap and a one-line pointer to `advanced.md`.

## 4. Writing `advanced.md`

- Structure as: durability/reliability concerns → failure modes and how to handle them → scaling/production concerns → monitoring/observability → a handful of "norms" (security, versioning, etc.) → a **checklist** at the end.
- The checklist at the end is not optional — it's the single most reusable artifact in the doc, the thing someone actually re-reads before a production launch.
- Explicitly call out **trade-offs**, not just "best practices" as absolutes. E.g., "full durability costs throughput — high-volume/low-criticality data might deliberately skip this." Presenting a practice without its cost teaches false confidence.
- If the topic has an interview angle (common for skills-focused guides), include a short section on **how to talk about this honestly in an interview** — especially if the person's real-world exposure is partial (e.g., "QA owns E2E, you own unit/integration — say that plainly, don't overclaim").

## 5. Writing `hands-on.md` + the project

This is where most of the actual effort and risk lives. Rules that matter:

- **The exercise must be one coherent scenario**, not a grab-bag of disconnected snippets. Pick something with enough surface area to demonstrate 3-4 real patterns naturally (e.g., an order-processing system that naturally needs fanout + retry + DLQ; an orders API that naturally needs unit + integration tests).
- **Write a numbered, step-by-step walkthrough** — not just "here's the code." Each step should have a concrete command to run and a concrete expected output, so the person always knows if they're on track.
- **Include a "break something on purpose" section.** This is consistently the highest-value part of a hands-on guide — deliberately introducing a bug and watching what catches it (or doesn't) teaches the underlying concept far better than reading about it in the abstract. Always include at least 2-3 of these.
- **End with a "what you actually just practiced" recap** tying each exercise step back to the concepts named in `basic.md`/`advanced.md` — this closes the loop and make the transfer explicit instead of implicit.

## 6. Non-negotiable: actually run the code before delivering it

This is the step most likely to get skipped under time pressure, and it's the one that matters most. Every runnable artifact in a guide must be executed, not just written and assumed correct:

- Install real dependencies, spin up the real service (broker, DB, etc.) if the sandbox allows it.
- Run every script/test file and confirm the output matches what the walkthrough claims it will show.
- If the sandbox can't run something (e.g., no Docker available), find the closest working substitute (e.g., install the tool natively via apt) rather than shipping unverified code. Only fall back to static checks (syntax compilation) as a last resort, and say so.
- **Test the "break something on purpose" sections too** — actually make the described change, confirm it fails the way the doc says it will, then revert it. An unverified "this will fail because X" is a guess, not documentation.
- If something breaks during testing (it will, occasionally), fix the actual bug — don't just patch the doc to describe the broken behavior.

A guide that's never been run is a draft, not a guide.

## 7. Final packaging checklist

- [ ] Clean up all generated artifacts (`__pycache__`, `node_modules`, `.pytest_cache`, lockfiles, coverage output) before presenting — the person should get source files, not run artifacts.
- [ ] `README.md` written last, once the other three files are final — it should accurately summarize what's actually in them, not what was originally planned.
- [ ] Every file actually copied to the outputs directory and presented — a file that's written but not surfaced is invisible to the person.
- [ ] If this guide will live in a repo alongside others, match the existing repo's structure/tone exactly (fetch and read an existing guide's README/structure first, don't assume).

## 8. Reusing this across different agents/sessions

Since this playbook is meant to be portable across agents that won't share memory of past guides:

- Paste this playbook document itself as context at the start of a new guide-building session.
- Also link (or paste) one previously completed guide as a concrete style/structure reference — the playbook describes the *process*, but a real example anchors tone and depth faster than the abstract rules alone.
- Re-state the scoping questions from step 2 explicitly each time, even if they feel repetitive — don't assume a new agent/session will infer them correctly from a one-line topic request.
