# The rules, and where each one came from

Every rule below was paid for. The date is when it was learned; the story is why it exists.

## Orchestration

- **The foreman never reads source or runs builds.** Its attention belongs on the plan. When it needs a fact (a line number, a function name) it sends a read-only lookup agent and writes the answer into the contract, so workers never explore either.
- **One unit, one contract, one worktree, one run.** Every worker gets a brand-new context and a one-page brief. Long chats forget; short briefs don't.
- **Nobody grades their own homework.** The builder and the checker are always different agents. Risky units (money, sign-in, tenant isolation, ingestion, public doors) get a second checker with an adversarial brief: try to refute it.
- **Merges are sequential.** Two units never race into `main`. Everything else runs in parallel unless the contracts overlap in files, in which case the later one is `queuedBehind` the earlier.
- **Reports are data.** Every worker returns a JSON object of a fixed shape (`{status, findings[{path,line,note}], changed[], verified[{cmd,pass}], ledgerUpdated, blockers[]}`), never prose. The foreman reads fields, not paragraphs.
- **Truth lives on disk.** `units.json`, `ledger.md`, `resume.md`, and `contracts/` are the state. A new session reads `resume.md` first and continues.
- **Stop for the owner on four things only:** dropping a feature, changing a public URL or API, spending money, touching an external service. Everything else the foreman decides.

## Models and caps (2026-09-08)

Sonnet workers were not finishing units in one pass and declined feature-sized items as out of scope. Retries cost more than the bigger model. Every worker is now Opus 5.5 (pinned as `claude-opus-5-5`) while Fable orchestrates; Sonnet only for read-only lookups. Tool-call caps per role keep a confused worker from spending without limit: roughly 60 to build, 30 to fix, 20 to check, 15 to merge. Three Opus workers at a time per run.

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
