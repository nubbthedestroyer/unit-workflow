---
name: unit-workflow
description: >-
  Multi-tier unit orchestration for large builds: contracts, per-unit worktrees,
  Opus port/fix/verify/merge tiers via the Workflow tool, a units.json registry, a ledger on
  disk, and a status command that shows every running unit's stage plus the last completed
  ones. Use whenever the owner says "use a workflow", "unit", "status?", "where are we",
  "summarize running units", "launch <thing> as a unit", or asks to queue work behind another unit.
---

# Unit workflow

One **unit** = one contract + one fresh worktree branch + one Workflow run through fixed tiers.
The orchestrator (the assistant the owner talks to) never reads source or runs build commands; agents do. Truth lives on disk:
`plan/units.json` (registry), `plan/ledger.md` (rows + phase log), `plan/resume.md`, `plan/contracts/NN-*.md`.

## Models (Opus everywhere)
| Role | model | effort | cap (tool calls) |
|---|---|---|---|
| port / fix | opus | medium | 60 / 30 |
| verify1 (Tier 1) | opus | low | 20 |
| verify2 (Tier 2, risky units only: tenancy, auth, money, ingestion, external doors) | opus | high | 20 |
| merge (sequential, one at a time) | opus | low | 15 |
| suite / review (integration) | opus | low / high | 20 |
| testers (E2E rounds) | opus | medium | 40 |
| Explore lookups (read-only index) | sonnet allowed | low | n/a |
Max 3 Opus agents in parallel per run (the template enforces it). Every spawn sets `model`.

## Lifecycle of a unit
1. **Number + contract.** Next NN from the ledger. Write `plan/contracts/NN-<key>.md` from `templates/contract.md`: purpose in the owner's words, Owns, reference slice (path:line), dependencies, pre-assigned migration numbers, acceptance commands. Workers never explore; the contract is the brief.
2. **Conflict check.** If the unit edits files another running unit owns, queue it: `queuedBehind: ["NN"]`. Otherwise launch now (parallel is the default).
3. **Register** in `plan/units.json` (see schema below), add the ledger row, note the run id in `plan/resume.md`, commit `plan/`.
4. **Launch** `Workflow({scriptPath: plan/round2-workflow.js, args: {units:[{key, risky, contract, brief}]}})` (template: `templates/unit-workflow.js`). One run can carry several disjoint units.
5. **Tiers** run inside the script: port -> verify1 (fix -> verify1, max 2 rounds) -> verify2 if risky -> sequential merge -> suite + review.
6. **On completion** update `units.json` (`status`, `mergedAt`, `outcome`), the ledger phase log, then launch anything queued behind it, then deploy if the owner expects it (`vercel deploy --prod --yes --archive=tgz` from the target repo).
7. Spend-limit errors kill agents silently: resume with `resumeFromRunId`; edited prompts invalidate the cached prefix, so new prompts mean a new run with `args.only`.

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

## Rules that keep it cheap and safe
- One-off fix agents that work directly on the main checkout must never run concurrently with each other (a `git add -A` sweeps the other agent's files); run them one at a time or give each a worktree. Workflow units are always in worktrees.
- Fresh agent per tier, own worktree at `<target>/.worktrees/<unit>`; if `node_modules` is missing there the agent runs `pnpm install --prefer-offline` once.
- Plain quotes only inside prompt strings (backticks and apostrophes broke script parsing).
- Batch shell, dot reporter, tail -40, never re-read files, skip build until merge.
- Integration suite runs with the checkout env files (`npx dotenv -e .env.development.local -e .env.local -- pnpm build`), never wrapped in `doppler run` (its dev DB port differs).
- Nothing external inside a workflow. Stop for the owner only on dropping a feature, public URL/API change, cost, anything external.
- Schema-only reports: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[]}`.
- After every merge wave: prune merged worktrees when the owner okays (Vercel CLI hits a 15k-file limit otherwise; use `--archive=tgz`).

## Current project defaults (edit for your project)
- Target repo: `<absolute path to the repo>`; plan dir: `<repo>/docs/plan` (`units.json`, `ledger.md`, `contracts/`, `round2-workflow.js` copied from `templates/unit-workflow.js` with `PLAN` and `TARGET` edited).
- Status: `node ~/.claude/skills/unit-workflow/scripts/status.mjs <repo>/docs/plan <session workflows dir>`.
- Worktree agents must stop ONLY the dev server they started (kill by the PID they saved, never `pkill -f next` or `killall node`); one-off main-checkout agents run one at a time; always `cd` with an absolute path before touching plan files.
- Before every production deploy: check and apply pending migrations, then deploy with your platform's command. Write the exact commands here so the foreman never guesses.
