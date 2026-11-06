# The rules, and where each one came from

Every rule below was paid for. The date is when it was learned; the story is why it exists.

## Orchestration

- **The foreman never reads source or runs builds.** Its attention belongs on the plan. When it needs a fact (a line number, a function name) it sends a read-only lookup agent and writes the answer into the contract, so workers never explore either.
- **One unit, one contract, one worktree, one run.** Every worker gets a brand-new context and a one-page brief. Long chats forget; short briefs don't.
- **Nobody grades their own homework.** The builder and the checker are always different agents. Risky units (money, sign-in, tenant isolation, ingestion, public doors) get a second checker with an adversarial brief: try to refute it.
- **Merges are sequential, and each unit merges as soon as it clears.** Two units never race into `main`, and no unit waits for the slowest one in its run; one integration pass runs after the last merge. Everything else runs in parallel unless the contracts overlap in files, in which case the later one is `queuedBehind` the earlier.
- **Reports are data.** Every worker returns a JSON object of a fixed shape (`{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[]}`), never prose. The foreman reads fields, not paragraphs.
- **Truth lives on disk.** `units.json`, `ledger.md`, `resume.md`, and `contracts/` are the state. A new session reads `resume.md` first and continues.
- **Stop for the owner on four things only:** dropping a feature, changing a public URL or API, spending money, touching an external service. Everything else the foreman decides.

## Models and caps (2026-09-08)

Sonnet workers were not finishing units in one pass and declined feature-sized items as out of scope. Retries cost more than the bigger model. Every worker is now pinned to Opus 5.5 (`claude-opus-5-5`), whatever model the foreman's session runs; Sonnet only for read-only lookups. Tool-call caps per role keep a confused worker from spending without limit: roughly 60 to build, 30 to fix, 20 to check, 15 to merge. Three Opus workers at a time per run, across every tier (`args.maxOpus` changes it).

## Models by kind of work (2026-11-06)

A 37-agent run on a client project (11 units of 15 to 24 findings each, Sonnet builders, Opus for heavy units and risky reviews) measured where the tokens went:

- **Sonnet builders were wordy, not cheap.** They ran 97 to 369 turns, peaked at up to 629K context and wrote up to 256K output tokens each. Per finding they used 0.5M to 4M cache-read tokens; the Opus builders used 2M to 3M. Sonnet is cheaper per token, but it spent more tokens.
- **Prompt caps did not hold.** No worker stopped at its stated cap. The fix is a real handoff: past about 50 tool calls a worker commits, writes a five-sentence note and stops, and the script starts a fresh agent from the note.
- **Sonnet is fast where the work is mechanical.** It walked screens in under a second each where Opus took about six, and Sonnet merges took 6 to 10 turns.
- **Reviews cost as much as builds** when the reviewer re-walked every screen at two sizes on Opus.
- **Lean agent types halve input.** A default agent started at about 110K tokens of connector and skill definitions; a lean agent with shell, file tools and a headless browser started at about 18K. Across about 1,000 turns that halved cache reads.

So: Opus writes and fixes code and judges risky diffs without a browser; Sonnet runs commands, walks only the screens a contract lists, merges and runs the suite; every agent is a lean type; units stay near 8 items. This replaces the 2026-09-08 rule below for every role except build and fix, which stay on Opus for the same reason as before.

## One script, launched by name

Every project used to carry its own edited copy of the workflow script, and the copies drifted. There is now one saved workflow (`unit-workflow`, linked into `~/.claude/workflows/`); paths, suite command and trailer arrive as launch `args`. Edited prompts invalidate the resume cache, so a rerun after a prompt change is a new run with `args.only` listing the unit keys that still need work.

## Overrides live outside the skill (2026-11-06)

Project defaults used to live in a marked section of `SKILL.md`. Every update meant copying the new skill over and hand-picking the private section back in, and the public copy kept picking up one project's names, paths and deploy commands. Now the skill is generic and replaced wholesale on update. Settings and rules live in override layers (`~/.claude/unit-workflow/`, `~/.claude/unit-workflow/projects/<repo>/`, `<repo>/.unit-workflow/`), and `scripts/resolve.mjs` merges them into the launch args before every run.

## Worktrees and processes

- **Kill only the PID you started (2026-09-10).** Workers were told to "stop any dev server you start" and implemented it as `pkill -f next`, which killed the owner's main dev server three times in one day. Prompts now say: save the PID, kill that PID, never `pkill` or `killall`.
- **One-off agents on the main checkout never run two at a time (2026-09-08).** One agent's `git add -A` swept up another's in-progress files into its commit. Give each a worktree, or serialize.
- **Never `git stash pop` blindly on the main checkout (2026-09-10).** An old stash from a previous session popped onto main and produced a dozen conflicted files mid-run. `git reset --hard HEAD` recovered it; the rule is to inspect `git stash list` before ever popping.
- **Always `cd` with an absolute path before touching plan files (2026-09-07).** Two stray ledger commits landed in the wrong repository because a chained command carried the working directory across.
- **Prune worktrees after every merge wave.** Sixty-two stale worktrees pushed a deploy over the CLI's file limit.

## Tests and the shared database

- Every worktree dev server and every live test suite shares one local Postgres. Live suites that seed and reseed must take the shared database lock; files that skipped it produced one-run failures that looked like regressions.
- **Test anchors by content, not position (2026-09-10, twice).** Two tests sliced a stylesheet from the last `prefers-reduced-motion` block; appending a new block later in the file broke both. Find the block that contains what you are asserting.
- **A seed that writes with `ON CONFLICT DO NOTHING` never removes stale rows.** Fixing a seed generator does not fix databases seeded before the fix; say so in the report.

## Deploys

- **Lockfile drift fails the build, not the tests (2026-09-10).** A unit removed a dependency from `package.json`; the lockfile still listed it; the hosted build's frozen install refused. The integration suite passed because local installs are not frozen. Regenerate the lockfile in the same commit as any dependency change.
- **Apply migrations before the code that needs them.** The foreman checks and applies pending migrations against production before every deploy that carries schema changes.
- **The queue's HTTP hop gives you five seconds (2026-09-10).** An endpoint that did the whole job before answering was reported as a failed delivery on every job longer than five seconds. Claim, answer, then work in the background.
