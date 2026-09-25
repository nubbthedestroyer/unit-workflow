# How it works

*How a production app gets built: one idea at a time, by a crew of AI workers, with a foreman who never touches the tools.*

---

## The one-paragraph version

You describe something you want. It becomes a **unit**: a single, well-bounded piece of work with a written brief. A fresh AI worker builds it in its own copy of the code. A second AI worker checks it. If anything is wrong, a third fixes it and the checker looks again. Only when it passes does it get merged into the real app, where a final check runs the whole test suite. All of this happens in the background while you keep talking about the next thing. Every step is written down, so anyone can see what happened and why.

That is the whole idea. Everything below is detail.

![The unit workflow: people on the left, the eight steps of one unit across the middle, and the files on disk that hold the truth along the bottom](diagrams/unit-workflow.png)

The editable version is [`diagrams/unit-workflow.drawio`](diagrams/unit-workflow.drawio) (draw.io, the VS Code draw.io extension, or app.diagrams.net); `diagrams/unit-workflow.py` regenerates it.

---

## Why we work this way

Building software with AI has a trap. If you ask one assistant to do everything in one long conversation, it starts to forget what it was told at the beginning, it reads half the codebase to find one file, and when two things are being built at once they step on each other. It also gets hard to know what is actually done versus what it *said* it did.

The unit workflow fixes that with four rules:

1. **Small, named pieces.** A unit is one feature or one fix, never "the whole app".
2. **Fresh eyes every time.** Each step is a brand-new worker that reads a short brief, not the whole history.
3. **Nobody grades their own homework.** The worker who built it is never the one who checks it.
4. **Truth lives on disk.** Status, decisions, and results are files in the repo, not memories in a chat.

## The cast

It helps to think of it as a small construction crew.

- **You** are the owner. You say what you want and answer the questions only you can answer (should we drop a feature, spend money, change a public URL).
- **The foreman** is the assistant you talk to. The foreman writes briefs, hands out work, reads reports, and keeps the ledger. The foreman deliberately does not read source code or run builds. That keeps its attention on the plan, not the plumbing.
- **The crew** are the AI workers. Each one exists for one job and then goes away:
  - the **builder** writes the code,
  - the **checker** tries to prove it works (and looks for what the builder missed),
  - the **fixer** repairs what the checker found,
  - the **merger** folds the finished work into the main branch,
  - the **inspector** runs the full test suite after the merge and explains any failure.

## The life of a unit

Here is what happens when you say, for example, "the drop zone should stay active after the first upload."

1. **Brief.** The foreman writes a one-page contract. It has your words at the top, a list of exactly which files the unit owns, which files it must not touch, where to copy patterns from, and the commands that prove it is done.
2. **Number and register.** The unit gets a number (73, say), a row in the ledger, and an entry in the registry so status tools can find it.
3. **Build.** A builder gets its own private copy of the codebase (a git worktree), reads the brief, and does the work. It cannot break anything you or another unit is doing, because it is working on a copy.
4. **Check.** A checker reads the same brief, runs the acceptance commands, clicks through the app, and reports. It either confirms or refutes, with file and line for every finding.
5. **Fix, then check again.** If refuted, a fixer addresses the findings and the checker looks again. At most two rounds.
6. **Second check for risky units.** Anything touching money, sign-in, tenant isolation, ingestion, or a public door gets a second, more thorough checker with a different lens.
7. **Merge.** A merger brings the branch into `main` as soon as the unit clears its checks, without waiting for the other units in the run. Merges happen one at a time so two units never race.
8. **Inspect.** After the last merge of the run, the full build and test suite run once on `main`. An inspector reads any failure and says whether it is new (this unit's fault) or pre-existing noise.
9. **Ship.** The foreman applies any database migrations to production and lets the deploy run. The ledger records the outcome.

The whole chain runs in the background. You can ask "status?" at any point and get a table of every unit, its stage, and how long it has been there.

## What you see

- **A contract** for every unit under `docs/plan/contracts/`. If you ever wonder "what did we actually ask for?", it is there in plain language.
- **A ledger** (`docs/plan/ledger.md`) with one row per unit and a log of every check, fix, and merge.
- **A registry** (`docs/plan/units.json`) that tools read to show status.
- **Resume notes** (`docs/plan/resume.md`) that let a brand-new session pick up exactly where the last one stopped.

## Things that make it feel different

**You can queue work behind other work.** If two units would edit the same files, the second waits for the first. If they don't overlap, they run at the same time.

**Feedback becomes units.** "The button is too close to the edge" and "the progress bars should be different colours" turned into unit 74 within minutes, with a contract that quotes you. Nothing gets lost in chat.

**Failures are explained, not just reported.** When the test suite goes red after a merge, the inspector traces each failure to a commit and says whether it belongs to this round. Most of the time it is a flaky fixture or a shared test database, and it says so.

**It is honest about scope.** Workers are told what they may not touch. A builder that needs something outside its brief reports a blocker instead of quietly widening the job.

---

## The deeper details

If the first half was enough, stop here. The rest is for people who want to know how the machine is put together.

### It runs on Claude Code's dynamic workflows

Claude Code has a tool that runs a small JavaScript script to orchestrate many AI agents deterministically. The script is `skill/unit-workflow/templates/unit-workflow.js` in this repository, linked into `~/.claude/workflows/` so the foreman launches it by name (`unit-workflow`) from any project; there is no per-project copy. Project settings (repo path, plan folder, suite command, commit trailer, worker cap) arrive as launch arguments. One call to it, with a list of units, produces the whole chain above: build, check, fix, second check, merge as each unit clears (one at a time), then one inspection pass. Each step is an `agent()` call with a prompt, a model, a tool-call cap, and, for anything that edits files, worktree isolation. Reports are forced into a JSON schema (`{status, findings, changed, verified, ledgerUpdated, blockers}`) so the foreman reads data, not prose.

Every run has an id (`wf_…`) and a journal of what each agent returned. If a run is stopped, resuming it replays the unchanged agents from cache and only runs what is new. If the prompts change, the cache no longer matches, so the foreman starts a new run with `args.only` naming just the units that still need work.

### Models and caps

The foreman (your main session) runs on Claude Fable. Every worker the script spawns is pinned to Claude Opus 5.5 (the owner's rule since September 2026: Sonnet was not finishing jobs in one pass, and retries cost more than the bigger model). At most three workers run at once per workflow run, across every tier; a launch argument can change the cap. Each role has a tool-call cap so a confused worker cannot spend without limit: roughly 60 calls to build, 30 to fix, 20 to check, 15 to merge.

### The two tiers of checking

Tier 1 asks "does it do what the contract says?" and runs at low effort: typecheck, unit tests, the app in a browser, screenshots to a scratch folder. Tier 2 exists only for risky units and runs at high effort with an adversarial brief: try to refute it, look for the tenancy or money mistake a happy-path test would miss.

### Where the guardrails come from

The repo's own gates do most of the work: `pnpm verify` checks that every database read goes through the tenancy wrapper, that no raw colour classes leak in, that every server action has a matching API tool, that the deploy checklist lists every environment variable, and more. Workers cannot mark a unit done without those passing. When a merge slips a gap through (it happens), the inspector names the file and line and a one-off fix agent closes it.

### One-off agents

Not everything deserves a full unit. A missing test assertion, a seed-data collision, a one-line registration: those go to a single agent in its own worktree with a thirty-call cap, and it pushes straight to `main` when green. The rule is that one-off agents never run two at a time on the main checkout, because one agent's `git add` can sweep up the other's files.

### The foreman's rules

The foreman never reads source files, never runs builds, and never explores the codebase. When it needs a fact (a line number, a function name) it sends a read-only lookup agent and writes the answer into the contract, so builders never explore either. The foreman only stops to ask the owner for four kinds of decisions: dropping a feature, changing a public URL or API, spending money, or anything that touches an external service.

### What it costs

A feature-sized unit runs somewhere between 400k and 1.1M tokens across its six to ten agents. That sounds like a lot until you compare it with a single long chat that reads the whole codebase twice and still ships something half-checked. The workflow spends tokens on isolation and verification instead of on rereading.

---

## In one sentence

Small briefs, fresh workers, nobody checks their own work, everything written down, and the person you talk to keeps their hands off the tools.
