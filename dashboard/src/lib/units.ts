/* eslint-disable @typescript-eslint/no-explicit-any -- parses loosely typed JSON from disk */
import "server-only"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  AgentView, ProjectSummary, RunState, RunView, SegState, Stage, StateResponse, UnitStatus, UnitView,
} from "./types"
import { DEMO_PLAN, demoPlan } from "./demo"

// Where the Workflow tool writes runs, and how long a run may go quiet before it counts as orphaned
const HOME = os.homedir()
const PROJECTS = process.env.CLAUDE_PROJECTS_DIR || path.join(HOME, ".claude/projects")
const LIVE_MS = Number(process.env.LIVE_MINUTES || 20) * 60_000

// ---------- small cached readers (keyed by mtime + size so each poll only re-reads what changed)
type CacheEntry<T> = { stamp: string; value: T }
const cache = new Map<string, CacheEntry<unknown>>()
function cached<T>(file: string, read: (f: string) => T): T | null {
  let st: fs.Stats
  try { st = fs.statSync(file) } catch { return null }
  const stamp = st.mtimeMs + ":" + st.size
  const hit = cache.get(file) as CacheEntry<T> | undefined
  if (hit && hit.stamp === stamp) return hit.value
  try {
    const value = read(file)
    cache.set(file, { stamp, value })
    return value
  } catch { return null }
}
const readJson = (f: string) => cached(f, (p) => JSON.parse(fs.readFileSync(p, "utf8")))
export const readJsonl = (f: string) => cached(f, (p) => fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
  .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)) as any[] | null
const countToolCalls = (f: string) => cached(f, (p) => (fs.readFileSync(p, "utf8").match(/"type":"tool_use"/g) || []).length)
const ls = (d: string) => { try { return fs.readdirSync(d) } catch { return [] } }
const mtime = (f: string) => { try { return fs.statSync(f).mtimeMs } catch { return 0 } }
const birth = (f: string) => { try { const s = fs.statSync(f); return s.birthtimeMs || s.ctimeMs } catch { return 0 } }

// ---------- runs
export interface RawAgent extends AgentView { unitKey: string | null }
export interface RawRun {
  runId: string
  name: string
  state: RunState
  startedAt: number | null
  lastActivity: number
  plan: string | null
  project: string | null
  units: Map<string, { risky: boolean | null }>
  agents: RawAgent[]
  logs: string[]
  tokens: number | null
}

const ROLE_PHASE: Record<string, string> = {
  port: "Port", verify1: "Tier 1", fix: "Tier 1", verify2: "Tier 2", merge: "Merge", ship: "Merge", suite: "Integration", review: "Integration",
}

function splitLabel(label: string) {
  const i = label.indexOf(":")
  if (i < 0) return { role: label, unitKey: null }
  const role = label.slice(0, i)
  let rest = label.slice(i + 1)
  if (role === "suite" || role === "review" || role === "ledger") return { role, unitKey: null }
  if (role === "fix") rest = rest.replace(/-\d+$/, "")
  return { role, unitKey: rest }
}

function verdictOf(result: any, preview?: string): string | null {
  if (result && typeof result === "object") return result.verdict || result.status || "done"
  if (preview) { const m = preview.match(/"(?:verdict|status)":"(\w+)"/); if (m) return m[1] }
  return null
}

export function readRun(runId: string, summaryFile: string | null, dir: string | null): RawRun {
  const summary = summaryFile ? readJson(summaryFile) : null
  let args: any = summary?.args
  if (typeof args === "string") { try { args = JSON.parse(args) } catch { args = null } }

  const agents = new Map<string, RawAgent>()
  const blank = (id: string, label: string, phase?: string): RawAgent => {
    const { role, unitKey } = splitLabel(label)
    return {
      id, label, role, unitKey, phase: phase || ROLE_PHASE[role] || "", model: "", state: "running", verdict: null,
      calls: null, tokens: null, startedAt: null, endedAt: null, lastTool: null, findings: [], blockers: [],
    }
  }

  let lastActivity = summaryFile ? mtime(summaryFile) : 0
  // The journal is the live source: started rows with no result yet are agents still working
  if (dir) {
    const journalFile = path.join(dir, "journal.jsonl")
    lastActivity = Math.max(lastActivity, mtime(journalFile))
    for (const ev of readJsonl(journalFile) || []) {
      if (ev.type === "started") {
        let label = ev.label
        if (!label) label = readJson(path.join(dir, `agent-${ev.agentId}.meta.json`))?.description || "agent"
        const a = blank(ev.agentId, label, ev.phase)
        const file = path.join(dir, `agent-${ev.agentId}.jsonl`)
        a.startedAt = birth(file) || null
        a.endedAt = mtime(file) || null
        lastActivity = Math.max(lastActivity, a.endedAt || 0)
        agents.set(ev.agentId, a)
      } else if (ev.type === "result" && agents.has(ev.agentId)) {
        const a = agents.get(ev.agentId)!
        a.state = "done"
        a.verdict = verdictOf(ev.result)
        a.findings = (ev.result?.findings || []).map((f: any) => `${f.path}${f.line ? ":" + f.line : ""} ${f.note}`)
        a.blockers = ev.result?.blockers || []
      } else if (ev.type === "failed" && agents.has(ev.agentId)) {
        agents.get(ev.agentId)!.state = "failed"
      }
    }
  }

  // The summary json (written when the run ends) carries tokens, calls and timing per agent
  for (const p of summary?.workflowProgress || []) {
    if (p.type !== "workflow_agent" || !p.agentId) continue
    const a = agents.get(p.agentId) || blank(p.agentId, p.label || "agent", p.phaseTitle)
    a.model = p.model || a.model
    a.tokens = p.tokens ?? a.tokens
    a.calls = p.toolCalls ?? a.calls
    a.lastTool = p.lastToolName || null
    if (p.startedAt) a.startedAt = p.startedAt
    if (p.startedAt && p.durationMs) a.endedAt = p.startedAt + p.durationMs
    if (!agents.has(p.agentId)) {
      a.state = p.state === "done" ? "done" : p.state === "failed" ? "failed" : a.state
      a.verdict = verdictOf(null, p.resultPreview)
    }
    agents.set(p.agentId, a)
  }

  // Fill in what only the agent files know: model and live tool-call counts
  if (dir) for (const a of agents.values()) {
    if (!a.model) a.model = readJson(path.join(dir, `agent-${a.id}.meta.json`))?.model || ""
    if (a.state === "running" && a.calls == null) a.calls = countToolCalls(path.join(dir, `agent-${a.id}.jsonl`))
  }

  const units = new Map<string, { risky: boolean | null }>()
  for (const u of args?.units || []) if (u?.key) units.set(u.key, { risky: typeof u.risky === "boolean" ? u.risky : null })
  for (const a of agents.values()) if (a.unitKey && !units.has(a.unitKey)) units.set(a.unitKey, { risky: null })

  const st = summary?.status
  let state: RunState
  if (st === "completed") state = "completed"
  else if (st === "killed" || st === "failed" || st === "error") state = "killed"
  else state = Date.now() - lastActivity < LIVE_MS ? "running" : "orphaned"
  if (state !== "running") for (const a of agents.values()) if (a.state === "running") a.state = "failed"

  const startedAt = summary?.startTime ? Number(summary.startTime) : (dir ? birth(path.join(dir, "journal.jsonl")) : null)
  return {
    runId, name: summary?.workflowName || "", state, startedAt, lastActivity,
    plan: args?.plan || null, project: args?.project || null, units,
    agents: [...agents.values()].sort((x, y) => (x.startedAt || 0) - (y.startedAt || 0)),
    logs: summary?.logs || [], tokens: summary?.totalTokens ?? null,
  }
}

// runId -> its subagents folder, refreshed on every scan; used to find one agent's transcript
const runDirs = new Map<string, string>()

export function agentFile(runId: string, agentId: string): string | null {
  if (!/^wf_[\w-]+$/.test(runId) || !/^[\w-]+$/.test(agentId)) return null
  if (!runDirs.has(runId)) scanRuns()
  const dir = runDirs.get(runId)
  return dir ? path.join(dir, `agent-${agentId}.jsonl`) : null
}

function scanRuns(): RawRun[] {
  const found = new Map<string, { summary: string | null; dir: string | null }>()
  for (const slug of ls(PROJECTS)) {
    for (const session of ls(path.join(PROJECTS, slug))) {
      const base = path.join(PROJECTS, slug, session)
      for (const f of ls(path.join(base, "workflows"))) {
        const m = f.match(/^(wf_[\w-]+)\.json$/)
        if (m) found.set(m[1], { ...(found.get(m[1]) || { dir: null }), summary: path.join(base, "workflows", f) })
      }
      for (const d of ls(path.join(base, "subagents", "workflows"))) {
        if (d.startsWith("wf_")) found.set(d, { ...(found.get(d) || { summary: null }), dir: path.join(base, "subagents", "workflows", d) })
      }
    }
  }
  for (const [id, f] of found) if (f.dir) runDirs.set(id, f.dir)
  return [...found].map(([id, f]) => readRun(id, f.summary, f.dir))
}

// ---------- plans
function discoverPlans(runs: RawRun[]): string[] {
  const dirs = new Set<string>()
  for (const d of (process.env.PLAN_DIRS || "").split(":").filter(Boolean)) dirs.add(path.resolve(d))
  const repos = path.join(HOME, "Documents/repos")
  for (const r of ls(repos)) { dirs.add(path.join(repos, r, "plan")); dirs.add(path.join(repos, r, "docs/plan")) }
  for (const r of ls(HOME)) if (!r.startsWith(".")) dirs.add(path.join(HOME, r, "plan"))
  for (const r of runs) if (r.plan) dirs.add(path.resolve(r.plan))
  return [...dirs].filter((d) => fs.existsSync(path.join(d, "units.json")))
}

function projectName(plan: string, runs: RawRun[]) {
  const named = runs.filter((r) => r.plan === plan && r.project).sort((a, b) => b.lastActivity - a.lastActivity)[0]
  const repo = path.basename(plan.replace(/\/(docs\/)?plan\/?$/, ""))
  return named ? `${named.project}` : repo
}

// ---------- unit derivation
const STAGE_OF_ROLE: Record<string, Stage> = { port: "port", verify1: "tier1", fix: "tier1", verify2: "tier2", merge: "merge", ship: "merge" }

function segState(a: RawAgent | undefined, ok: string[]): SegState {
  if (!a) return "pending"
  if (a.state === "running") return "running"
  if (a.state === "failed") return "failed"
  return ok.includes(a.verdict || "done") ? "done" : "failed"
}

function deriveUnit(reg: any, run: RawRun | null): Omit<UnitView, "waitingOn"> & { _deps: string[] } {
  const agents = run ? run.agents.filter((a) => a.unitKey === reg.key) : []
  const last = (role: string) => agents.filter((a) => a.role === role).at(-1)
  const risky = run?.units.get(reg.key)?.risky ?? null
  const live = run?.state === "running"

  const port = segState(last("port"), ["done", "partial"])
  const fixes = agents.filter((a) => a.role === "fix")
  const v1 = last("verify1")
  const fix = fixes.at(-1)
  let tier1: SegState = segState(v1, ["verified"])
  if (fix && fix.state === "running") tier1 = "fix"
  else if (tier1 === "failed" && live && v1?.verdict === "refuted" && fixes.length < 2) tier1 = "fix"
  const v2 = last("verify2")
  const m = last("merge") || last("ship")
  let tier2: SegState = segState(v2, ["verified"])
  if (!v2 && (risky === false || m || (tier1 === "done" && !live))) tier2 = "skipped"
  const merge = segState(m, ["done"])

  let integration: SegState = "pending"
  if (merge === "done" && run) {
    const suite = run.agents.filter((a) => a.role === "suite").at(-1)
    if (!suite) integration = live ? "pending" : "skipped"
    else if (suite.state === "running") integration = "running"
    else if (suite.state === "failed") integration = "failed"
    else integration = suite.blockers.length ? "fix" : "done"
  }

  const activeAgent = agents.find((a) => a.state === "running") || null
  let status: UnitStatus
  let stage: Stage
  let note: string | null = null
  const segments = { port, tier1, tier2, merge, integration }

  const regDone = reg.status === "merged" || reg.status === "pr-open"
  if (reg.status === "deferred") { status = "deferred"; stage = "queued" }
  else if (run && merge === "done") { status = "merged"; stage = "merged"; if (reg.status === "pr-open") note = "PR open, not merged to main yet" }
  else if (regDone && !live) {
    status = "merged"; stage = "merged"
    note = reg.status === "pr-open" ? "PR open, not merged to main yet" : run ? "merged outside the workflow run" : null
    if (!run) for (const k of Object.keys(segments) as (keyof typeof segments)[]) segments[k] = "done"
  }
  else if (run && activeAgent) { status = "running"; stage = STAGE_OF_ROLE[activeAgent.role] || "port" }
  else if (run && agents.length) {
    // Furthest stage this unit reached, or the next one if the run is still live
    stage = m ? "merge" : (tier2 !== "pending" && tier2 !== "skipped") ? "tier2" : v1 || fix ? "tier1" : "port"
    if (live) {
      if (tier1 === "done" && tier2 !== "pending") stage = "merge"
      else if (tier1 === "done") stage = risky ? "tier2" : "merge"
      else if (port === "done" && !v1) stage = "tier1"
      status = "between"
      note = stage === "merge" ? "cleared checks, waiting for the merge lock" : "waiting for a free agent slot"
    } else if (run.state === "completed") {
      status = "blocked"
      note = "run finished without merging this unit"
    } else {
      status = "stale"
      note = run.state === "killed" ? "run was killed before this unit merged" : "run went quiet before this unit merged"
    }
  } else if (run && live) { status = "between"; stage = "port"; note = "run launched, waiting for a free agent slot" }
  else if (reg.status === "blocked") { status = "blocked"; stage = "queued" }
  else if (reg.status === "running") { status = "stale"; stage = "queued"; note = "registry says running, but no run is on disk" }
  else { status = "ready"; stage = "queued" }

  // Registry drift: units.json disagrees with what the run says happened
  if (!note && run && reg.status !== status && !(reg.status === "running" && (status === "between"))) {
    if (reg.status === "queued" && (status === "merged" || status === "running")) note = `units.json still says queued; run says ${status}`
    else if (reg.status === "running" && status === "merged") note = "units.json still says running; merge is done"
  }

  const times = agents.flatMap((a) => [a.startedAt || 0, a.endedAt || 0])
  return {
    n: String(reg.n ?? ""), key: reg.key, title: reg.title || reg.key, outcome: reg.outcome || null, contract: reg.contract || null,
    registryStatus: reg.status, status, stage, risky, runId: run?.runId || reg.runId || null, runState: run?.state || null,
    segments, fixRounds: fixes.length, deps: [], _deps: reg.queuedBehind || [], agents, activeAgent, note,
    launchedAt: reg.launchedAt || null, mergedAt: reg.mergedAt || null,
    lastActivity: times.length ? Math.max(...times) : (reg.mergedAt ? Date.parse(reg.mergedAt) : null),
  }
}

function buildPlan(plan: string, runs: RawRun[]) {
  const reg: any[] = readJson(path.join(plan, "units.json"))?.units || []
  const keys = new Set(reg.map((u) => u.key))
  const nkeys = new Map(reg.map((u) => [`${u.n}-${u.key}`, u.key]))
  // Older scripts label agents "<n>-<key>"; map those back onto the registry key
  const canon = (k: string | null) => (k && !keys.has(k) && nkeys.has(k) ? nkeys.get(k)! : k)
  runs = runs.map((r) => ({
    ...r,
    agents: r.agents.map((a) => ({ ...a, unitKey: canon(a.unitKey) })),
    units: new Map([...r.units].map(([k, v]) => [canon(k)!, v])),
  }))
  // Only runs that belong to this plan (by args.plan, or by touching its unit keys when args.plan is absent)
  const mine = runs.filter((r) => (r.plan ? path.resolve(r.plan) === plan : [...r.units.keys()].some((k) => keys.has(k))))
  const built = assemblePlan(reg, mine)
  return { ...built, lastActivity: Math.max(mtime(path.join(plan, "units.json")), built.lastActivity) }
}

export function assemblePlan(reg: any[], mine: RawRun[]) {
  const latestFor = (key: string, hint: string | null) => {
    const touching = mine.filter((r) => r.units.has(key) || r.agents.some((a) => a.unitKey === key))
    if (!touching.length) return null
    return touching.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || mine.find((r) => r.runId === hint) || null
  }

  const raw = reg.map((u) => deriveUnit(u, latestFor(u.key, u.runId)))
  const byN = new Map(raw.map((u) => [u.n, u.key]))
  const byKey = new Map(raw.map((u) => [u.key, u]))
  const units: UnitView[] = raw.map(({ _deps, ...u }) => {
    const deps = _deps.map((d: string) => byN.get(String(d)) || d).filter((k: string) => byKey.has(k) && k !== u.key)
    const waitingOn = deps.filter((k: string) => byKey.get(k)!.status !== "merged")
    let status = u.status
    if (status === "ready" && waitingOn.length) status = "waiting"
    return { ...u, status, deps, waitingOn }
  })

  const unitRuns = new Set(units.map((u) => u.runId).filter(Boolean))
  const runViews: RunView[] = mine.filter((r) => unitRuns.has(r.runId)).map((r) => {
    const suite = r.agents.filter((a) => a.role === "suite").at(-1) || null
    const review = r.agents.filter((a) => a.role === "review").at(-1) || null
    let integration: SegState = "pending"
    if (suite) integration = suite.state === "running" ? "running" : suite.state === "failed" ? "failed" : suite.blockers.length ? "fix" : "done"
    else if (r.state !== "running") integration = "skipped"
    if (review?.state === "running") integration = "running"
    return {
      runId: r.runId, name: r.name, state: r.state, startedAt: r.startedAt, lastActivity: r.lastActivity,
      unitKeys: units.filter((u) => u.runId === r.runId).map((u) => u.key), integration,
      suite, review, logs: r.logs.slice(-8), tokens: r.tokens,
    }
  })
  return { units, runs: runViews, lastActivity: Math.max(0, ...mine.map((r) => r.lastActivity)) }
}

export function getState(selected: string | null): StateResponse {
  // UNIT_DASHBOARD_DEMO_ONLY=1 skips the disk scan and serves only the simulated project
  const demoOnly = process.env.UNIT_DASHBOARD_DEMO_ONLY === "1"
  const runs = demoOnly ? [] : scanRuns()
  const plans = demoOnly ? [] : discoverPlans(runs)
  const built = new Map(plans.map((p) => [p, buildPlan(p, runs)]))
  const projects: ProjectSummary[] = plans.map((p) => {
    const b = built.get(p)!
    const counts: ProjectSummary["counts"] = {}
    for (const u of b.units) counts[u.status] = (counts[u.status] || 0) + 1
    return { plan: p, name: projectName(p, runs), counts, lastActivity: b.lastActivity }
  }).sort((a, b) => b.lastActivity - a.lastActivity)

  // A simulated project that loops every few minutes, so the motion can be seen when nothing is running
  if (process.env.UNIT_DASHBOARD_DEMO !== "0") {
    const d = demoPlan()
    built.set(DEMO_PLAN, { ...d, lastActivity: 0 })
    const counts: ProjectSummary["counts"] = {}
    for (const u of d.units) counts[u.status] = (counts[u.status] || 0) + 1
    projects.push({ plan: DEMO_PLAN, name: "Demo (simulated)", counts, lastActivity: 0 })
  }
  const plan = selected && built.has(selected) ? selected : projects[0]?.plan || null
  const b = plan ? built.get(plan)! : { units: [], runs: [] }
  return { generatedAt: Date.now(), projects, plan, units: b.units, runs: b.runs }
}
