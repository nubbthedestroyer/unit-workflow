---
name: unit-workflow
description: >-
  Multi-tier unit orchestration for large builds: contracts, per-unit worktrees,
  Opus 5.5 port/fix/verify/merge tiers via the Workflow tool, a units.json registry, a ledger on
  disk, and a status command that shows every running unit's stage plus the last completed
  ones. Use whenever the owner says "use a workflow", "unit", "status?", "where are we",
  "summarize running units", "launch <thing> as a unit", or asks to queue work behind another unit.
---

# Unit workflow

One **unit** = one contract + one fresh worktree branch + one Workflow run through fixed tiers.
The orchestrator (the assistant the owner talks to) never reads source or runs build commands; agents do. Truth lives on disk:
`plan/units.json` (registry), `plan/ledger.md` (rows + phase log), `plan/resume.md`, `plan/contracts/NN-*.md`.

## Models (Fable orchestrates, Opus 5.5 everywhere else)
| Role | model | effort | cap (tool calls) |
|---|---|---|---|
| orchestrator (main session: contracts, launches, status) | Fable (session model, not set in the script) | session | n/a |
| port / fix | claude-opus-5-5 | medium | 60 / 30 |
| verify1 (Tier 1) | claude-opus-5-5 | low | 20 |
| verify2 (Tier 2, risky units only: tenancy, auth, money, ingestion, external doors) | claude-opus-5-5 | high | 20 |
| merge (sequential, one at a time) | claude-opus-5-5 | low | 15 |
| suite / review (integration) | claude-opus-5-5 | low / high | 20 |
| testers (E2E rounds) | claude-opus-5-5 | medium | 40 |
| Explore lookups (read-only index) | sonnet allowed | low | n/a |
Max 3 Opus agents in parallel per run across every tier (the template routes all agents through one limiter; `args.maxOpus` overrides). Every spawn sets `model: WORKER_MODEL` (`claude-opus-5-5`) so workers stay on Opus 5.5 even though the session runs Fable.

## Lifecycle of a unit
1. **Number + contract.** Next NN from the ledger. Write `plan/contracts/NN-<key>.md` from `templates/contract.md`: purpose in the owner's words, Owns, reference slice (path:line), dependencies, pre-assigned migration numbers, acceptance commands. Workers never explore; the contract is the brief.
2. **Conflict check.** If the unit edits files another running unit owns, queue it: `queuedBehind: ["NN"]`. Otherwise launch now (parallel is the default).
3. **Register** in `plan/units.json` (see schema below), add the ledger row, note the run id in `plan/resume.md`, commit `plan/`.
4. **Launch** the saved workflow by name: `Workflow({name: 'unit-workflow', args: {target, plan, units:[{key, risky, contract, brief}], ...project defaults}})`. It is `templates/unit-workflow.js`, linked into `~/.claude/workflows/`; never copy it per project. Project settings (`project`, `planDocs`, `suiteCmd`, `trailer`, `maxOpus`) go in `args`. One run can carry several disjoint units.
5. **Tiers** run inside the script, per unit with no barrier: port -> verify1 (fix -> verify1, max 2 rounds) -> verify2 if risky -> merge. Each unit merges as soon as it clears, one merge at a time; the suite + review run once after the last merge.
6. **On completion** update `units.json` (`status`, `mergedAt`, `outcome`), the ledger phase log, then launch anything queued behind it, then deploy if the owner expects it (`vercel deploy --prod --yes --archive=tgz` from the target repo).
7. Spend-limit errors kill agents silently: resume with `resumeFromRunId`; edited prompts invalidate the cached prefix, so new prompts mean a new run with `args.only: ["<key>", ...]` (same `units` list; only those keys run).

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
- Schema-only reports: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[]}`.
- After every merge wave: prune merged worktrees when the owner okays (Vercel CLI hits a 15k-file limit otherwise; use `--archive=tgz`).

## Project defaults
The owner keeps real defaults (paths, suite command, deploy commands) in their private copy of this section. Shape:
- Target repo and plan dir: `<absolute path to the repo>`, plan at `<repo>/docs/plan/` (`units.json`, `ledger.md`, `contracts/`). No script copy lives in the plan dir: launch the saved `unit-workflow`.
- Launch args (add `units`, and `only` when rerunning a subset):
  ```json
  {"target": "/absolute/path/to/your-repo", "plan": "/absolute/path/to/your-repo/docs/plan",
   "project": "Your project", "planDocs": "architecture.md, contracts/<unit>.md",
   "suiteCmd": "pnpm build, then pnpm test --reporter=dot (tail -60), then pnpm verify",
   "trailer": "Co-Authored-By: Claude <noreply@anthropic.com>", "maxOpus": 3}
  ```
- Status: `node ~/.claude/skills/unit-workflow/scripts/status.mjs <repo>/docs/plan <session workflows dir>`.
- Worktree agents must stop ONLY the dev server they started (kill by the PID they saved, never `pkill -f next` or `killall node`, which kills the main checkout server); one-off main-checkout agents run one at a time; always `cd` with an absolute path before touching plan files.
- Before every production deploy: check and apply pending migrations, then deploy with your platform's command. Write the exact commands here so the foreman never guesses.
