// Shared shapes between the API route and the client

export type SegState = "pending" | "running" | "done" | "fix" | "failed" | "skipped"
export type Stage = "queued" | "port" | "tier1" | "tier2" | "merge" | "merged"
export type UnitStatus =
  | "running" // an agent is working on it right now
  | "between" // run is live but no agent is on it (agent slot or merge lock)
  | "waiting" // queued behind a unit that is not merged yet
  | "ready" // queued, nothing in the way
  | "merged"
  | "blocked"
  | "stale" // run was killed or went quiet before the unit cleared
  | "deferred"

export type RunState = "running" | "completed" | "killed" | "orphaned"

export interface AgentView {
  id: string
  label: string
  role: string // port, verify1, fix, verify2, merge, suite, review
  phase: string
  model: string
  state: "running" | "done" | "failed"
  verdict: string | null
  calls: number | null
  tokens: number | null
  startedAt: number | null
  endedAt: number | null
  lastTool: string | null
  findings: string[]
  blockers: string[]
}

export interface UnitView {
  n: string
  key: string
  title: string
  outcome: string | null
  contract: string | null
  registryStatus: string
  status: UnitStatus
  stage: Stage
  risky: boolean | null
  runId: string | null
  runState: RunState | null
  segments: Record<"port" | "tier1" | "tier2" | "merge" | "integration", SegState>
  fixRounds: number
  deps: string[] // keys this unit is queued behind
  waitingOn: string[] // the deps that are not merged yet
  agents: AgentView[]
  activeAgent: AgentView | null
  note: string | null // drift or stale explanation
  launchedAt: string | null
  mergedAt: string | null
  lastActivity: number | null
}

export interface RunView {
  runId: string
  name: string
  state: RunState
  startedAt: number | null
  lastActivity: number | null
  unitKeys: string[]
  integration: SegState
  suite: AgentView | null
  review: AgentView | null
  logs: string[]
  tokens: number | null
}

export interface ProjectSummary {
  plan: string
  name: string
  counts: Partial<Record<UnitStatus, number>>
  lastActivity: number
}

export interface StateResponse {
  generatedAt: number
  projects: ProjectSummary[]
  plan: string | null
  units: UnitView[]
  runs: RunView[]
}

export interface LogEvent {
  i: number
  t: number | null
  kind: "prompt" | "text" | "tool" | "report"
  tool?: string
  title: string
  detail?: string
  output?: string
  error?: boolean
  pending?: boolean
  ms?: number
}
