/* eslint-disable @typescript-eslint/no-explicit-any -- parses loosely typed JSON from disk */
import type { LogEvent } from "./types"
import type { RawAgent, RawRun } from "./units"
import { assemblePlan } from "./units"

// A hand-timed loop of three runs: dependencies, a fix round, a merge-lock wait, a blocked unit and a queued chain
export const DEMO_PLAN = "demo"
const PERIOD = 240
const MODEL = "claude-opus-5-5"

type Span = [role: string, start: number, end: number, verdict: string, blockers?: string[]]
const REG = [
  { n: "39", key: "seed-data", title: "Seed fixtures and tenant bootstrap", status: "merged", mergedAt: "2026-10-15T12:00:00Z", outcome: "fixtures + bootstrap; merged 1a2b3c4" },
  { n: "40", key: "auth-core", title: "Session auth, org tenancy guard, API keys", queuedBehind: ["39"] },
  { n: "41", key: "billing-ledger", title: "Usage ledger, invoices, Stripe test-mode sync", queuedBehind: ["40"] },
  { n: "42", key: "ui-shell", title: "App shell, nav, theme tokens, empty states" },
  { n: "43", key: "reports", title: "Monthly reports on ledger data with CSV export", queuedBehind: ["41", "42"] },
  { n: "44", key: "search-index", title: "Full-text search index over documents and notes" },
  { n: "45", key: "notifications", title: "Email + in-app notifications with digest" },
  { n: "46", key: "exports", title: "Scheduled exports to S3 with signed links", queuedBehind: ["43"] },
]
const RUNS: { id: string; launch: number; units: Record<string, { risky: boolean; spans: Span[] }>; suite: [number, number] }[] = [
  {
    id: "wf_demo-a1", launch: 0, suite: [100, 118], units: {
      "auth-core": { risky: true, spans: [["port", 0, 35, "done"], ["verify1", 35, 50, "verified"], ["verify2", 50, 68, "verified"], ["merge", 70, 82, "done"]] },
      "ui-shell": { risky: false, spans: [["port", 0, 25, "done"], ["verify1", 25, 38, "refuted"], ["fix", 38, 55, "done"], ["verify1", 55, 66, "verified"], ["merge", 82, 92, "done"]] },
      "search-index": { risky: true, spans: [["port", 2, 40, "done"], ["verify1", 40, 52, "refuted"], ["fix", 52, 66, "done"], ["verify1", 66, 78, "refuted"], ["fix", 78, 90, "done"], ["verify1", 90, 99, "refuted"]] },
    },
  },
  { id: "wf_demo-b2", launch: 95, suite: [160, 172], units: { "billing-ledger": { risky: true, spans: [["port", 95, 120, "done"], ["verify1", 120, 132, "verified"], ["verify2", 132, 148, "verified"], ["merge", 150, 160, "done"]] } } },
  { id: "wf_demo-c3", launch: 162, suite: [218, 232], units: { reports: { risky: false, spans: [["port", 162, 190, "done"], ["verify1", 190, 205, "verified"], ["merge", 207, 217, "done"]] } } },
]

export function demoPlan() {
  // UNIT_DASHBOARD_DEMO_SPEED plays the loop faster (handy for recordings); displayed times stay in demo seconds
  const speed = Number(process.env.UNIT_DASHBOARD_DEMO_SPEED || 1)
  const now = Date.now()
  const t = ((now * speed) / 1000) % PERIOD
  const at = (s: number) => now - (t - s) * 1000
  // The seed unit merged two hours ago, so it stays on the flowchart for the whole loop
  const reg = REG.map((u) => ({
    ...u, status: u.status || "queued", queuedBehind: u.queuedBehind || [],
    ...(u.mergedAt ? { mergedAt: new Date(now - 2 * 3600_000).toISOString() } : {}),
  })) as any[]
  const runs: RawRun[] = []

  for (const r of RUNS) {
    if (t < r.launch) continue
    const agents: RawAgent[] = []
    const mk = (label: string, role: string, unitKey: string | null, [s, e]: [number, number], verdict: string, phase: string, blockers: string[] = []) => {
      if (t < s) return
      const running = t < e
      agents.push({
        id: label + "@" + r.id + "@" + s, label, role, unitKey, phase, model: MODEL, state: running ? "running" : "done", verdict: running ? null : verdict,
        calls: Math.round((Math.min(t, e) - s) * 0.7), tokens: Math.round((Math.min(t, e) - s) * 2400), startedAt: at(s), endedAt: running ? now : at(e),
        lastTool: running ? ["Bash", "Edit", "Read", "Grep"][Math.floor(t / 3) % 4] : "StructuredOutput",
        findings: verdict === "refuted" ? ["src/lib/search.ts:88 tokenizer drops quoted phrases", "tests/search.test.ts:12 acceptance case fails"] : [], blockers,
      })
    }
    const PH: Record<string, string> = { port: "Port", verify1: "Tier 1", fix: "Tier 1", verify2: "Tier 2", merge: "Merge" }
    for (const [key, u] of Object.entries(r.units)) {
      let fixes = 0
      for (const [role, s, e, v] of u.spans) mk(role === "fix" ? `fix:${key}-${++fixes}` : `${role}:${key}`, role, key, [s, e], v, PH[role])
      const row = reg.find((x) => x.key === key)
      row.status = "running"
      row.runId = r.id
      row.launchedAt = new Date(at(r.launch)).toISOString()
      const m = u.spans.find((x) => x[0] === "merge")
      if (m && t >= m[2]) { row.status = "merged"; row.mergedAt = new Date(at(m[2])).toISOString(); row.outcome = "verified and merged" }
    }
    mk("suite:main", "suite", null, r.suite, "done", "Integration")
    const ended = t >= r.suite[1] + 1
    if (ended) for (const row of reg) if (row.runId === r.id && row.status === "running") { row.status = "blocked"; row.outcome = "Tier 1 refuted after 2 fix rounds" }
    runs.push({
      runId: r.id, name: "unit-workflow", state: ended ? "completed" : "running", startedAt: at(r.launch), lastActivity: now,
      plan: DEMO_PLAN, project: "Demo", units: new Map(Object.entries(r.units).map(([k, u]) => [k, { risky: u.risky }])),
      agents, logs: agents.filter((a) => a.state === "done").slice(-6).map((a) => `${a.label}: ${a.verdict}`), tokens: null,
    })
  }
  return assemblePlan(reg, runs)
}

// ---------- simulated transcripts, revealed step by step as the demo agent runs
type Step = [tool: string, title: string, output?: string, error?: boolean]
const BRIEF = (role: string, key: string) =>
  `Demo project. Repo ~/code/demo. Plan ~/code/demo/docs/plan (contracts/<unit>.md). Rules: work only in your own worktree ~/code/demo/.worktrees/${key} on branch unit/${key}; batch shell commands; never re-read a file; commit with trailer and push your branch. Return ONLY the structured result.\n\nYou are ${role}:${key}. Contract: docs/plan/contracts/${key}.md.`

function steps(role: string, key: string, verdict: string | null): Step[] {
  const wt = `~/code/demo/.worktrees/${key}`
  const file = `src/lib/${key.replace(/-/g, "_")}.ts`
  const test = `tests/${key}.test.ts`
  if (role === "port" || role === "fix") return [
    ["text", role === "port" ? "Reading the contract, then building in the worktree." : "Fixing the two Tier 1 findings, then re-running the failing commands."],
    ["Read", `~/code/demo/docs/plan/contracts/${key}.md`, "## Owns\n- " + file + "\n- " + test + "\n## Acceptance test\npnpm typecheck; pnpm vitest run " + test],
    ["Bash", `git worktree add -b unit/${key} ${wt} origin/main && cd ${wt} && pnpm install --prefer-offline`, "Preparing worktree (new branch 'unit/" + key + "')\nPackages: +812\nDone in 6.1s"],
    ["Read", `${wt}/${file}`, "export function handler() {\n  // TODO\n}"],
    ["Edit", `${wt}/${file}`, "The file has been updated."],
    ["Write", `${wt}/${test}`, "File created successfully."],
    ["Bash", "pnpm typecheck", "> tsc --noEmit\n(no errors)"],
    ["Bash", `pnpm vitest run ${test} --reporter=dot`, " ✓ " + test + " (6 tests) 412ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)"],
    ["Bash", `git add -A && git commit -m "${key}: ${role}" && git push -u origin unit/${key}`, `[unit/${key} 3f9c2a1] ${key}: ${role}\n 3 files changed, 148 insertions(+), 12 deletions(-)`],
    ["Edit", "~/code/demo/docs/plan/ledger.md", "The file has been updated."],
    ["report", JSON.stringify({ status: "done", findings: [], changed: [file, test], verified: [{ cmd: "pnpm typecheck", pass: true }, { cmd: "pnpm vitest run " + test, pass: true }], ledgerUpdated: true, blockers: [] }, null, 2)],
  ]
  if (role === "verify1" || role === "verify2") {
    const refuted = verdict === "refuted"
    return [
      ["text", role === "verify2" ? "Refute-only pass over the Owns list." : "Running every acceptance command from the contract."],
      ["Bash", `cd ${wt} && git diff --stat origin/main...HEAD`, ` ${file}  | 96 +++++++++\n ${test} | 52 +++++\n 2 files changed, 148 insertions(+)`],
      ["Bash", "pnpm typecheck", "> tsc --noEmit\n(no errors)"],
      ["Bash", `pnpm vitest run ${test} --reporter=dot`, refuted
        ? ` ❯ ${test} (6 tests | 2 failed)\n   × keeps quoted phrases together\n     → expected [ 'full', 'text' ] to deeply equal [ 'full text' ]\n   × acceptance: search returns the seeded note\n\n Test Files  1 failed (1)\n      Tests  2 failed | 4 passed (6)`
        : ` ✓ ${test} (6 tests) 398ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)`, refuted],
      ["Grep", `quoted in ${wt}/src`, `${file}:88:  // quoted phrases are split on whitespace`],
      ["Bash", "pnpm verify", "verify: 14 checks passed"],
      ["report", JSON.stringify({ verdict: verdict || "verified", findings: refuted ? [{ path: file, line: 88, note: "tokenizer drops quoted phrases" }, { path: test, line: 12, note: "acceptance case fails" }] : [], verified: [{ cmd: "pnpm vitest run " + test, pass: !refuted }], ledgerUpdated: true }, null, 2)],
    ]
  }
  if (role === "merge") return [
    ["Bash", "git status --short && git checkout main && git pull --ff-only", "Already on 'main'\nAlready up to date."],
    ["Bash", `git merge --no-ff origin/unit/${key} -m "merge: ${key}"`, "Merge made by the 'ort' strategy.\n 3 files changed, 148 insertions(+), 12 deletions(-)"],
    ["Bash", "pnpm install && pnpm typecheck", "Done in 2.3s\n> tsc --noEmit\n(no errors)"],
    ["Bash", `pnpm vitest run ${test} --reporter=dot`, " Test Files  1 passed (1)\n      Tests  6 passed (6)"],
    ["Bash", "git push origin main", "To github.com:demo/demo.git\n   a1b2c3d..e4f5a6b  main -> main"],
    ["report", JSON.stringify({ status: "done", findings: [], changed: [], verified: [{ cmd: "pnpm typecheck", pass: true }], ledgerUpdated: true, blockers: [] }, null, 2)],
  ]
  return [
    ["Bash", "git pull && pnpm build", "✓ Compiled successfully in 18.2s"],
    ["Bash", "pnpm test --reporter=dot 2>&1 | tail -60", " Test Files  84 passed (84)\n      Tests  1022 passed (1022)"],
    ["Bash", "pnpm verify", "verify: 14 checks passed"],
    ["report", JSON.stringify({ status: "done", findings: [], changed: [], verified: [{ cmd: "pnpm test", pass: true }], ledgerUpdated: true, blockers: [] }, null, 2)],
  ]
}

export function demoAgentLog(agentId: string): LogEvent[] | null {
  const plan = demoPlan()
  const all = [...plan.units.flatMap((u) => u.agents), ...plan.runs.flatMap((r) => [r.suite, r.review])]
  const a = all.find((x) => x && x.id === agentId)
  if (!a || !a.startedAt) return null
  const key = a.label.split(":")[1]?.replace(/-\d+$/, "") || "main"
  const list = steps(a.role, key, a.verdict)
  const end = a.state === "running" ? Date.now() : a.endedAt || Date.now()
  // A running agent shows the steps it has reached; the report only appears once it is done
  const total = a.state === "running" ? list.length - 1 : list.length
  const progress = a.state === "running" ? Math.min(0.95, (end - a.startedAt) / Math.max(1, (a.endedAt || end) - a.startedAt + 15000)) : 1
  const shown = Math.max(1, Math.ceil(total * progress))
  const span = (end - a.startedAt) / Math.max(1, shown + 1)
  const events: LogEvent[] = [{ i: 0, t: a.startedAt, kind: "prompt", title: "Brief", detail: BRIEF(a.role, key) }]
  list.slice(0, shown).forEach(([tool, title, output, error], n) => {
    const t = a.startedAt! + span * (n + 1)
    const last = n === shown - 1 && a.state === "running"
    if (tool === "text") events.push({ i: events.length, t, kind: "text", title })
    else if (tool === "report") events.push({ i: events.length, t, kind: "report", tool: "Report", title: "Final report", detail: title })
    else events.push({ i: events.length, t, kind: "tool", tool, title, output: last ? undefined : output, error, pending: last, ms: last ? undefined : Math.round(span * 0.7) })
  })
  return events
}
