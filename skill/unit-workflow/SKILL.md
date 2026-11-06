---
name: unit-workflow
description: >-
  Multi-tier unit orchestration for large builds: contracts, per-unit worktrees,
  Opus builds and judges while lean Sonnet agents run checks, walk screens and merge, via the Workflow tool, a units.json registry, a ledger on
  disk, a status command that shows every running unit's stage plus the last completed
  ones, and a live web dashboard (board and flowchart views, agent logs). Use whenever the owner
  says "use a workflow", "unit", "status?", "where are we", "summarize running units",
  "launch <thing> as a unit", "dashboard", or asks to queue work behind another unit.
---

# Unit workflow

One **unit** = one contract + one fresh worktree branch + one Workflow run through fixed tiers.
The orchestrator (the assistant the owner talks to) never reads source or runs build commands; agents do. Truth lives on disk:
`plan/units.json` (registry), `plan/ledger.md` (rows + phase log), `plan/resume.md`, `plan/contracts/NN-*.md`.

## Models: Opus thinks and writes code, Sonnet runs and walks
The foreman (the main session) does the thinking up front: it writes each contract to file:line precision, so no worker explores. Inside the run:

| Role | model | agent type | effort | budget (tool calls) |
|---|---|---|---|---|
| foreman (main session: contracts, launches, status) | session model | n/a | session | n/a |
| port (build) | Opus `claude-opus-5-5` | lean-worker | medium | 50, then handoff |
| fix (after a failed check) | Opus | lean-worker | medium | 50, then handoff |
| verify1 (run typecheck, verify, acceptance commands) | Sonnet `claude-sonnet-5-5` | lean-checker | low | 20 |
| walk (screens the unit names, headless browser) | Sonnet | lean-checker | low | 30 |
| verify2 (risky units: auth, permissions, tenancy, money, ingestion, external doors; reads the diff, no browser) | Opus | lean-checker | high | 20 |
| merge (sequential, one at a time) | Sonnet | lean-worker | low | 15 |
| suite (full suite once after the last merge) | Sonnet | lean-checker | low | 20 |
| review (decide regression or pre-existing for suite failures) | Opus | lean-checker | high | 20 |

Why this split (2026-11-06 measurements; full story in `docs/rules.md`):
- Opus writes code. It one-shots more often; Sonnet builders on big briefs ran 100 to 370 turns, wrote up to 256K output tokens each and were not cheaper per item.
- Sonnet runs and walks. It moves through screens in under a second where Opus takes about six, and merges took 6 to 10 turns. Commands and screen checks are mechanical, so speed wins.
- Opus judges without a browser. A risky-unit review reads the diff and the walk's screen results; it never re-walks screens.
- Overrides: `args.models` per role (`{build: 'sonnet'}` etc., `opus`/`sonnet` or full ids); a unit can set `build: 'sonnet'` for mechanical edits (it then applies to that unit's fixes too). A Sonnet build that stalls or escalates is retried once on Opus automatically.
- Concurrency: `args.maxOpus` (default 3) and `args.maxSonnet` (default 6), across every tier.

### Lean agent types
Every agent uses `lean-worker` (edits) or `lean-checker` (reads, runs commands, headless Playwright). They skip connectors and skills, so an agent starts at about 18K tokens instead of about 110K, and that saving repeats on every turn. Install them once at user level: copy `agents/lean-worker.md` and `agents/lean-checker.md` from this repo into `~/.claude/agents/`. An agent type loads only in sessions started after the file exists: check the Agent tool's list before launching. Without them, pass `workerType: 'general-purpose', checkerType: 'general-purpose'` (works, costs far more).

### Context budget and handoff
Prompt caps alone do not hold. Builders now stop after about `args.handoffAt` (default 50) tool calls, commit, and return `status: partial` with a five-sentence `handoff`. The script starts a fresh agent on the same worktree from that note, up to `args.maxHandoffs` (default 2). This keeps context near 100K instead of 600K.

## Lifecycle of a unit
1. **Number + contract.** Next NN from the ledger. Write `plan/contracts/NN-<key>.md` from `templates/contract.md`: purpose in the owner's words, Owns, reference slice (path:line), the diagnosis and intended change for each item, dependencies, pre-assigned migration numbers, acceptance commands, and the Walk list (screens and checks) if the unit changes UI. Workers never explore; the contract is the brief. Keep a unit to about 8 items: big units are what blow up turns and context.
2. **Conflict check.** If the unit edits files another running unit owns, queue it: `queuedBehind: ["NN"]`. Otherwise launch now (parallel is the default).
3. **Register** in `plan/units.json` (see schema below), add the ledger row, note the run id in `plan/resume.md`, commit `plan/`.
4. **Launch** the saved workflow by name: `Workflow({name: 'unit-workflow', args: {target, plan, units:[{key, risky, contract, brief, walk?, build?}], ...project defaults}})`. It is `templates/unit-workflow.js`, linked into `~/.claude/workflows/`; never copy it per project. Project settings (`project`, `planDocs`, `suiteCmd`, `trailer`, `models`, `maxOpus`, `maxSonnet`, `handoffAt`) go in `args`. `walk` is a one-line list of screens and checks (copy the contract's Walk section); omit it for units with no UI. One run can carry several disjoint units. Git and tooling options: `baseBranch` (default `main`; units fork from and merge into it), `remote` (default `origin`), `push: false` (local only: no pull, no push; use it for repos you cannot push to or where the base is a feature branch), `pm` (`pnpm` default, `npm`, `yarn`), and `installCmd` / `typecheckCmd` / `verifyCmd` to override the pm defaults.
5. **Tiers** run inside the script, per unit with no barrier: port (with handoffs) -> verify1 -> walk if the unit has one (a failure from either goes to an Opus fix, then both checks again, max 2 rounds) -> verify2 if risky -> merge. Each unit merges as soon as it clears, one merge at a time; the suite + review run once after the last merge.
6. **On completion** update `units.json` (`status`, `mergedAt`, `outcome`), the ledger phase log, then launch anything queued behind it, then deploy if the owner expects it (`vercel deploy --prod --yes --archive=tgz` from the target repo).
7. After editing `templates/unit-workflow.js` mid-session, launch with `Workflow({scriptPath: '~/.claude/skills/unit-workflow/templates/unit-workflow.js', args})` rather than `{name: 'unit-workflow'}`: a by-name launch can run the copy cached at session start, so new args are silently ignored.
8. Spend-limit errors kill agents silently: resume with `resumeFromRunId`; edited prompts invalidate the cached prefix, so new prompts mean a new run with `args.only: ["<key>", ...]` (same `units` list; only those keys run).

## units.json schema
```json
{"units":[{"n":"41","key":"chat-streaming","title":"instant pending dots, smooth streaming","contract":"41-chat-streaming.md",
  "runId":"wf_de34cc6b-252","status":"running|queued|merged|blocked|deferred","queuedBehind":["40"],
  "launchedAt":"2026-09-08T14:40:00Z","mergedAt":null,"outcome":"one line"}]}
```

## Status (when the owner asks "status", "where are we", "summarize running units")
Run: `node ~/.claude/skills/unit-workflow/scripts/status.mjs <plan dir> <session workflows dir>`
- workflows dir = `~/.claude/projects/<project-slug>/<session-id>/subagents/workflows` (the Workflow tool result prints it).
- It joins `units.json` with each run's `journal.jsonl` and `agent-*.jsonl` / `.meta.json`: current agent label (port/fix/verify1/verify2/merge/suite/review), model, tool calls so far, elapsed, verdicts recorded, and merge state.
- Present two tables: **Running / queued** (unit, what, stage, agent calls, elapsed, run id) and **Last completed** (default 5: unit, what, outcome, merged commit, tokens if known). Add one line of next action. Keep prose under the tables to three sentences.

## Dashboard (when the owner says "dashboard", "launch the dashboard", "show the board")
The live dashboard is a Next.js app in the public repo at `dashboard/`. It's read-only: it finds `units.json` plan dirs and the Workflow run journals on its own, polls every 3 s, and gives Board and Flowchart views, per-unit details and live agent logs.
- **Source:** a detached worktree of `origin/main` at `~/Documents/repos/unit-workflow-dashboard` (`git -C ~/Documents/repos/unit-workflow worktree add --detach ~/Documents/repos/unit-workflow-dashboard origin/main`). Use a worktree so a diverged local `main` is never touched. To refresh: `git -C <worktree> checkout --detach origin/main` after a fetch.
- **Install once:** `cd <worktree>/dashboard && npx -y pnpm@9 install --frozen-lockfile` (pnpm may not be installed; npx works).
- **Run:** port 3040, with `PLAN_DIRS=<plan dir>` to pin the current project's plan (it also auto-discovers past `args.plan` dirs). In the desktop app, start it through `.claude/launch.json` and the browser pane (`preview_start`), not a background shell: `{"name":"unit-workflow-dashboard","runtimeExecutable":"sh","runtimeArgs":["-c","cd <worktree>/dashboard && PLAN_DIRS=<plan> npx -y pnpm@9 dev -p 3040"],"port":3040}`. The first start takes about 30 to 60 s.
- **Demo without real units:** `npx -y pnpm@9 demo` on :3041.
- Keep `units.json` accurate (`runId`, `status`, `queuedBehind`): the dashboard flags it when the registry disagrees with a run.

## Update check (every direct invocation)
When the skill is invoked directly (`/unit-workflow ...`), check for updates before doing anything else; skip it when the skill is auto-routed mid-task.
1. `git -C <repo> fetch -q origin && git -C <repo> status -sb | head -1` where `<repo>` is the local clone of github.com/nubbthedestroyer/unit-workflow (default `~/Documents/repos/unit-workflow`; skip silently if it does not exist).
2. `diff -rq <installed skill dir> <repo>/skill/unit-workflow` (ignore the owner-name scrub and the commit trailer).
3. If origin is ahead of the clone, or the repo copy differs from the installed copy: say so in one line and offer to pull and copy the repo files over the installed ones (never overwrite the private project-defaults section; re-apply it after copying). If the installed copy is ahead, offer to sync it into the repo and push, as in the last sync commit.
4. No difference: say nothing and continue.

## Rules that keep it cheap and safe
- One-off fix agents that work directly on the main checkout must never run concurrently with each other (a `git add -A` sweeps the other agent's files); run them one at a time or give each a worktree. Workflow units are always in worktrees.
- Fresh agent per tier, own worktree at `<target>/.worktrees/<unit>`; if `node_modules` is missing there the agent runs `pnpm install --prefer-offline` once.
- Plain quotes only inside prompt strings (backticks and apostrophes broke script parsing).
- Batch shell, dot reporter, tail -40, never re-read files, skip build until merge.
- Integration suite runs with the env files the checkout already carries (pass the exact command as `args.suiteCmd`); do not wrap it in a secrets runner whose dev settings differ from the local database.
- Nothing external inside a workflow. Stop for the owner only on dropping a feature, public URL/API change, cost, anything external.
- Schema-only reports: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[], handoff?, escalate?}`; `status` is one word (`done`, `partial`, `blocked`); checkers add `screens[{route,viewport,pass,note,shot}]`.
- No narration between tool calls, every note one sentence. Output tokens are the slowest and most expensive part of a worker.
- Builders never open a browser; only `walk` does, and only for the screens the contract lists. Reviewers never re-walk.
- No attribution trailer by default; set `args.trailer` only if the project wants one.
- After every merge wave: prune merged worktrees when the owner okays (Vercel CLI hits a 15k-file limit otherwise; use `--archive=tgz`).

## Project defaults
The owner keeps real defaults (paths, suite command, deploy commands) in their private copy of this section. Shape:
- Target repo and plan dir: `<absolute path to the repo>`, plan at `<repo>/docs/plan/` (`units.json`, `ledger.md`, `contracts/`). No script copy lives in the plan dir: launch the saved `unit-workflow`.
- Launch args (add `units`, and `only` when rerunning a subset):
  ```json
  {"target": "/absolute/path/to/your-repo", "plan": "/absolute/path/to/your-repo/docs/plan",
   "project": "Your project", "planDocs": "architecture.md, contracts/<unit>.md",
   "suiteCmd": "pnpm build, then pnpm test --reporter=dot (tail -60), then pnpm verify",
   "maxOpus": 3, "maxSonnet": 6, "handoffAt": 50}
  ```
- Status: `node ~/.claude/skills/unit-workflow/scripts/status.mjs <repo>/docs/plan <session workflows dir>`.
- Worktree agents must stop ONLY the dev server they started (kill by the PID they saved, never `pkill -f next` or `killall node`, which kills the main checkout server); one-off main-checkout agents run one at a time; always `cd` with an absolute path before touching plan files.
- Before every production deploy: check and apply pending migrations, then deploy with your platform's command. Write the exact commands here so the foreman never guesses.
