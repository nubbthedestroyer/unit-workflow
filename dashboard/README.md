# unit-workflow dashboard

**Watch your AI crew work.** A live, local map of every unit: what is being built, what is being checked, what is waiting on what, and what just merged.

![The flowchart view, live: units move through Port, Tier 1, Tier 2, Merge and Integration while dependency arrows show who is waiting on whom](../docs/dashboard/live-flowchart.gif)

It reads the files unit-workflow already writes (`units.json` and the Workflow tool's run journals), so there is nothing to connect. It checks for changes every 3 seconds and never writes anything.

## Try it in 30 seconds

No units of your own yet? The demo plays a simulated build on a loop.

```bash
cd dashboard
pnpm install
pnpm demo
```

Open http://localhost:3041.

To watch your real runs:

```bash
pnpm dev -p 3040
```

Open http://localhost:3040.

## Two views

**Flowchart.** Your plan as a dependency tree that ends in `main`. The chart holds still while the cards change color as work moves through them. It lays itself out for the window it is in: top to bottom on a portrait monitor, left to right on a wide one, with long chains wrapped into rows, and it zooms to fill the space.

<p align="center"><img src="../docs/dashboard/flowchart-portrait.png" alt="Flowchart on a portrait monitor" width="420"></p>

**Board.** One column per stage: Queued, Port, Tier 1, Tier 2, Merge, Merged, Integration. A card sits in the column of whoever is working on it right now.

![Board view](../docs/dashboard/board.png)

**Details.** Click a card for its agents, models, tool calls, tokens and verdicts, the findings against it, and the units it is holding up.

![Unit details](../docs/dashboard/details.png)

**Agent logs.** Click an agent in the details panel and its full log opens over the page: the brief it was given, what it said, every command, read and edit with its output, and its final report. While the agent is running, the log refreshes every 2 seconds and follows the newest step. Failed commands are marked in red and start expanded.

![An agent's log streaming in](../docs/dashboard/agent-log.gif)

![Agent log: a checker's failing test run and its refuted report](../docs/dashboard/agent-log.png)

## Reading a card

- **The five-cell bar** is the unit's path: Port, T1, T2, Merge, Int. Blue stripes: running. Green: done. Amber stripes: a fix round, with a badge counting the rounds. Red: failed. Hatched: skipped, which is Tier 2 on a unit that is not risky.
- **Arrows** are `queuedBehind` dependencies and point at the unit that is waiting. Blue and moving: the blocker is running. Amber dashed: the blocker is itself waiting. Grey: met.
- **Status** is one of running, between agents (waiting for a free agent slot or the merge lock), waiting on, ready, merged, blocked, stale (the run was killed or went quiet), deferred.
- **A note** appears when `units.json` disagrees with what the run actually did, so a stale registry is easy to spot.

## Where it looks

- `units.json` in `~/Documents/repos/*/plan`, `~/Documents/repos/*/docs/plan`, `~/*/plan`, any `args.plan` from a past run, and any folder in `PLAN_DIRS`.
- Runs in `~/.claude/projects/*/*/workflows/wf_*.json` (written when a run ends) and `~/.claude/projects/*/*/subagents/workflows/wf_*/journal.jsonl` (live agent starts and results).
- Agent logs in `agent-<id>.jsonl` next to each run's journal.

| Setting | Default | What it does |
|---|---|---|
| `PLAN_DIRS` | none | Extra plan folders, colon separated. |
| `LIVE_MINUTES` | 20 | A run with no activity for this long counts as stale. |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Where Claude Code keeps session files. |
| `UNIT_DASHBOARD_DEMO` | on | Set to `0` to hide the simulated Demo project. |
| `UNIT_DASHBOARD_DEMO_ONLY` | off | Set to `1` to show only the demo (what `pnpm demo` does). |
| `UNIT_DASHBOARD_DEMO_SPEED` | 1 | Play the demo loop faster, for recordings. |

## Built with

Next.js, React Flow, dagre, shadcn/ui and Tailwind. Local only: no sign-in, no database. It is meant to sit on a second monitor while you keep talking to the foreman.
