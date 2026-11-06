---
name: unit-workflow
description: >-
  Multi-tier unit orchestration for large builds: contracts, per-unit worktrees,
  Opus builds and judges while lean Sonnet agents run checks, walk screens and merge, via the Workflow tool,
  a units.json registry, a ledger on disk, a status command, a live web dashboard, and layered overrides
  (user and project) for settings and rules. Use whenever the owner says "use a workflow", "unit", "status?",
  "where are we", "summarize running units", "launch <thing> as a unit", "dashboard", asks to queue work
  behind another unit, or asks to customize or override how units run.
---

# Unit workflow

One **unit** = one contract + one fresh worktree branch + one Workflow run through fixed tiers.
The foreman (the assistant the owner talks to) never reads source or runs build commands; agents do. Truth lives on disk:
`<plan>/units.json` (registry), `<plan>/ledger.md` (rows + phase log), `<plan>/resume.md`, `<plan>/contracts/NN-*.md`.

## Start here: resolve the settings (every launch)
This skill is generic. Everything specific to a person, a project or a tool lives in **override layers** outside it. Before writing a contract or launching, run:

```sh
node ~/.claude/skills/unit-workflow/scripts/resolve.mjs <repo>
```

It prints the files it read, the contract template to use, the **Foreman notes** (follow them: deploy steps, ports, when to stop), and the **launch args** (pass them to the Workflow tool and add `units`). With `--json` it prints one object `{args, foreman, contractTemplate, sources}`. Never edit this skill's files for one project; put it in an override layer instead.

## Customize: the override layers
Layers merge lowest to highest; later wins.

| # | Layer | Where | Who it is for |
|---|---|---|---|
| 1 | built-in | `~/.claude/skills/unit-workflow/defaults.json` | everyone; replaced on every update, never edit |
| 2 | user | `~/.claude/unit-workflow/config.json`, `overrides.md` | you, every project |
| 3 | user + project | `~/.claude/unit-workflow/projects/<repo folder name>/` (`config.json`, `overrides.md`, `contract.md`) | you, one project, kept out of the repo |
| 4 | project | `<repo>/.unit-workflow/` (`config.json`, `overrides.md`, `contract.md`) | the team; committed with the repo |
| 5 | launch | the `args` the foreman passes | one run (`units`, `only`, one-off changes) |

**`config.json`** holds launch args. Objects (`models`, `roleNotes`) merge key by key; everything else replaces. Keys starting with `//` are comments.

| Key | Default | Meaning |
|---|---|---|
| `target` | the repo you resolved | absolute repo path |
| `planDir` / `plan` | `docs/plan` / `<target>/docs/plan` | plan folder (relative / absolute) |
| `project`, `planDocs` | `Project build`, `contracts/<unit>.md` | name and the docs every worker may read |
| `pm` | `pnpm` | `pnpm`, `npm` or `yarn`; picks install, typecheck, verify and build commands |
| `installCmd`, `typecheckCmd`, `verifyCmd`, `suiteCmd` | from `pm` | override any command |
| `baseBranch`, `remote`, `push` | `main`, `origin`, `true` | `push: false` keeps everything local |
| `trailer` | none | commit trailer, only if the project wants one |
| `models` | see Models | per role: `opus`, `sonnet` or a full model id |
| `workerType`, `checkerType` | `lean-worker`, `lean-checker` | agent types for editing and for checking roles |
| `maxOpus`, `maxSonnet` | 3, 6 | concurrent agents per model family, across every tier |
| `handoffAt`, `maxHandoffs` | 50, 2 | tool calls before a builder hands off; how many fresh continuations |
| `rules` | none | text added to every worker prompt (usually from `overrides.md`) |
| `roleNotes` | none | `{role: text}` added to one role's prompt |

**`overrides.md`** holds plain-language rules, in sections with these exact headings:
- `## Foreman`: read by the main session only (deploy and migration steps, dev server ports, when to stop and ask, local paths such as the dashboard checkout).
- `## All workers`: added to every worker prompt.
- `## Role: <role>`: added to one role; roles are `port`, `fix`, `verify1`, `walk`, `verify2`, `merge`, `suite`, `review`.

Sections from every layer are kept, lower layers first.

**`contract.md`** in layer 3 or 4 replaces the contract template.

**Agent types.** Project-level agents (`<repo>/.claude/agents/lean-worker.md`) take precedence over user-level ones (`~/.claude/agents/`), so a project can give its workers different tools under the same name, or point `workerType` / `checkerType` at its own types.

**Scaffold and inspect.**
- `node <clone>/install.mjs --project <repo>` writes a starter `<repo>/.unit-workflow/`.
- Starter files are in `templates/overrides/`. A worked example for a fictional app is in the repo's `examples/.unit-workflow/`.
- To add a rule the owner states ("always...", "never..." for this project), write it into the right layer's `overrides.md` instead of remembering it. Then run `resolve.mjs` again.

## Models: Opus thinks and writes code, Sonnet runs and walks
The foreman does the thinking up front: it writes each contract to file:line precision, so no worker explores. Inside the run:

| Role | model | agent type | effort | budget (tool calls) |
|---|---|---|---|---|
| port (build) | Opus | lean-worker | medium | 50, then handoff |
| fix (after a failed check) | Opus | lean-worker | medium | 50, then handoff |
| verify1 (typecheck, verify, acceptance commands) | Sonnet | lean-checker | low | 20 |
| walk (the screens the unit names, headless browser) | Sonnet | lean-checker | low | 30 |
| verify2 (risky units: auth, permissions, tenancy, money, ingestion, external doors; reads the diff, no browser) | Opus | lean-checker | high | 20 |
| merge (sequential, one at a time) | Sonnet | lean-worker | low | 15 |
| suite (full suite once after the last merge) | Sonnet | lean-checker | low | 20 |
| review (regression or pre-existing, for suite failures) | Opus | lean-checker | high | 20 |

Why this split (full story in the repo's `docs/rules.md`, 2026-11-06):
- **Opus writes code.** It finishes in one pass more often. Sonnet builders on big briefs ran 100 to 370 turns and were not cheaper per item.
- **Sonnet runs and walks.** It moves through screens in under a second where Opus takes about six. Commands and screen checks are mechanical.
- **Opus judges without a browser.** A risky-unit review reads the diff and the walk's screen results.
- **Changing models.** Change any role with `models`. A unit can set `build: 'sonnet'` for mechanical edits, which also covers that unit's fixes. A Sonnet build that stalls or escalates is retried once on Opus.

### Lean agent types
Every agent uses `lean-worker` (edits) or `lean-checker` (reads, runs commands, headless browser). They skip connectors and skills, so an agent starts at about 18K tokens instead of about 110K, and that saving repeats on every turn. `install.mjs` puts them in `~/.claude/agents/`. An agent type loads only in sessions started after its file exists, so check the Agent tool's list before launching. Without them, set `workerType` and `checkerType` to `general-purpose`; that works but costs far more.

### Context budget and handoff
Prompt caps alone do not hold. After about `handoffAt` tool calls a builder commits and returns `status: partial` with a five-sentence `handoff`. The script then starts a fresh agent on the same worktree from that note, up to `maxHandoffs` times.

## Lifecycle of a unit
1. **Resolve** the settings (above).
2. **Number + contract.** Take the next NN from the ledger. Write `<plan>/contracts/NN-<key>.md` from the resolved contract template, with:
   - purpose in the owner's words;
   - Owns;
   - reference slice (path:line);
   - the cause and intended change for each item;
   - dependencies and pre-assigned migration numbers;
   - acceptance commands;
   - the Walk list (screens and checks), if the unit changes UI.

   Workers never explore: the contract is the brief. Keep a unit to about 8 items.
3. **Conflict check.** If the unit edits files another running unit owns, queue it with `queuedBehind: ["NN"]`. Otherwise launch now; parallel is the default.
4. **Register** in `units.json` (schema below), add the ledger row, note the run id in `resume.md`, commit the plan folder.
5. **Launch** the saved workflow by name: `Workflow({name: 'unit-workflow', args: {...resolved args, units:[{key, risky, contract, brief, walk?, build?}]}})`.
   - `walk` is a one-line copy of the contract's Walk section; omit it for units with no UI.
   - One run can carry several disjoint units.
   - The script is `templates/unit-workflow.js`, linked into `~/.claude/workflows/`; never copy it per project.
6. **Tiers** run inside the script, per unit, with no barrier:
   - port (with handoffs), then verify1, then walk if the unit has one;
   - a failure from either check goes to an Opus fix, then both checks run again, at most 2 rounds;
   - verify2 if risky, then merge.

   Each unit merges as soon as it clears, one merge at a time. The suite and review run once after the last merge.
7. **On completion:**
   - update `units.json` (`status`, `mergedAt`, `outcome`) and the ledger phase log;
   - launch anything queued behind the unit;
   - follow the Foreman notes for deploys.

   The result lists `blockers`, `escalate` and `handoff` for any unit that did not merge.
8. **Edited the script mid-session?** Launch with `Workflow({scriptPath: '~/.claude/skills/unit-workflow/templates/unit-workflow.js', args})` instead. A by-name launch can run the copy cached at session start.
9. **Spend-limit errors kill agents silently.** Resume with `resumeFromRunId`. Edited prompts (including changed overrides) invalidate the cached prefix, so they mean a new run with `args.only: ["<key>", ...]`.

## units.json schema
```json
{"units":[{"n":"12","key":"board-filters","title":"filter the board by assignee and label","contract":"12-board-filters.md",
  "runId":"wf_0a1b2c3d-002","status":"running|queued|merged|blocked|deferred","queuedBehind":["11"],
  "launchedAt":"2026-03-02T10:00:00Z","mergedAt":null,"outcome":"one line"}]}
```

## Status (when the owner asks "status", "where are we", "summarize running units")
Run: `node ~/.claude/skills/unit-workflow/scripts/status.mjs <plan dir> <session workflows dir>`
- The workflows dir is `~/.claude/projects/<project-slug>/<session-id>/subagents/workflows`; the Workflow tool result prints it.
- It joins `units.json` with each run's journal and agent logs. For each unit it shows the current agent (port, fix, verify1, walk, verify2, merge, suite, review), the model, tool calls so far, time elapsed, recorded verdicts and merge state.
- Present two tables:
  - **Running / queued:** unit, what, stage, agent calls, elapsed, run id.
  - **Last completed** (default 5): unit, what, outcome, merged commit.

  Add one line on the next action, and keep prose under the tables to three sentences.

## Dashboard (when the owner says "dashboard", "launch the dashboard", "show the board")
The live dashboard is the Next.js app in the repo's `dashboard/`. It's read-only: it finds plan dirs and Workflow run journals on its own and polls every 3 s.
- **Source:** a detached worktree of the clone's `origin/main`, so a diverged local `main` is never touched. If the Foreman notes name a path, use it.
- **Install once:** `cd <worktree>/dashboard && npx -y pnpm@9 install --frozen-lockfile`.
- **Run:** port 3040 with `PLAN_DIRS=<plan dir>`. In the desktop app, start it through `.claude/launch.json` and the browser pane, not a background shell. The first start takes 30 to 60 s.
- **Demo:** `npx -y pnpm@9 demo` on :3041.

## Update check (every direct invocation)
When the skill is invoked directly (`/unit-workflow ...`), check for updates before anything else. Skip this when the skill is auto-routed mid-task.
1. Find the local clone of the unit-workflow repo. The Foreman notes may name it; otherwise skip silently.
2. Run `git -C <clone> fetch -q origin && git -C <clone> status -sb | head -1` and `diff -rq ~/.claude/skills/unit-workflow <clone>/skill/unit-workflow`.
3. If origin is ahead, or the copies differ, say so in one line. Offer to pull and run `node <clone>/install.mjs`. Overrides live outside the skill, so updating never loses them.
4. If nothing differs, say nothing and continue.

## Rules that keep it cheap and safe
- One-off agents working directly on the main checkout never run at the same time. One agent's `git add -A` sweeps up the other's files. Workflow units always run in worktrees.
- Each tier gets a fresh agent in its own worktree at `<target>/.worktrees/<unit>`. If dependencies are missing there, it runs the install command once.
- Use plain quotes only inside prompt strings; backticks and apostrophes broke script parsing.
- Batch shell commands, use a dot reporter, pipe long output through `tail -40`, never re-read a file, and skip the build until merge.
- The integration suite runs with the env files the checkout already carries. Pass the exact command as `suiteCmd`.
- Nothing external happens inside a workflow. Stop for the owner only on these: dropping a feature, changing a public URL or API, cost, or anything external.
- Reports are schema-only: `{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[], handoff?, escalate?}`.
  - `status` is one word: `done`, `partial` or `blocked`.
  - Checkers add `screens[{route,viewport,pass,note,shot}]`.
- No narration between tool calls, and every note is one sentence.
- Builders never open a browser. Only `walk` does, and only for the screens the contract lists.
- After every merge wave, prune merged worktrees once the owner agrees.
