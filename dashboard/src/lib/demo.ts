/* eslint-disable @typescript-eslint/no-explicit-any -- parses loosely typed JSON from disk */
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
