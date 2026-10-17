"use client"

import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Clock, GitBranch, GitMerge, Hourglass, Layers, Loader2, ShieldAlert, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { SEG, SEGMENTS, STATUS, ago, shortModel } from "@/lib/status"
import type { RunView, UnitView } from "@/lib/types"

export const NODE_W = 260
export const NODE_H = 138

const hidden = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent"

function Handles() {
  return (
    <>
      <Handle id="tgt-l" type="target" position={Position.Left} className={hidden} />
      <Handle id="tgt-r" type="target" position={Position.Right} className={hidden} />
      <Handle id="tgt-t" type="target" position={Position.Top} className={hidden} />
      <Handle id="src-l" type="source" position={Position.Left} className={hidden} />
      <Handle id="src-r" type="source" position={Position.Right} className={hidden} />
      <Handle id="src-b" type="source" position={Position.Bottom} className={hidden} />
    </>
  )
}

export function SegmentBar({ u, big }: { u: UnitView; big?: boolean }) {
  return (
    <div className={cn("grid grid-cols-5 gap-0.5", big ? "h-7" : "h-5")}>
      {SEGMENTS.map(({ k, short }) => {
        const s = u.segments[k]
        const skipT2 = k === "tier2" && u.risky === false
        return (
          <div
            key={k}
            title={`${short}: ${skipT2 ? "not risky" : SEG[s].label}`}
            className={cn(
              "relative flex items-center justify-center rounded-[3px] font-mono font-medium transition-colors duration-700",
              big ? "text-xs" : "text-[10px]",
              SEG[s].cls,
            )}
          >
            {short}
            {k === "tier1" && u.fixRounds > 0 && (
              <span className="absolute -right-1 -top-1.5 rounded-full bg-amber-400 px-1 text-[9px] leading-3.5 text-amber-950">
                ×{u.fixRounds}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export type UnitNodeData = { u: UnitView; byKey: Record<string, UnitView>; now: number; flash: boolean; selected: boolean }

export function UnitNode({ data }: NodeProps & { data: UnitNodeData }) {
  const { u, byKey, now, flash, selected } = data
  const st = STATUS[u.status]
  const a = u.activeAgent
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2 rounded-lg border px-3 py-2.5 text-left shadow-lg shadow-black/30 backdrop-blur-sm transition-[border-color,background-color,opacity,box-shadow] duration-700",
        st.node,
        flash && "unit-flash",
        selected && "ring-2 ring-white/60",
      )}
    >
      <Handles />
      <div className="flex items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", st.dot, (u.status === "running" || u.status === "between") && "animate-pulse")} />
        <span className="font-mono text-[11px] text-zinc-500">#{u.n}</span>
        <span className={cn("truncate font-mono text-xs font-semibold text-zinc-100", u.status === "deferred" && "line-through")}>{u.key}</span>
        {u.risky && <ShieldAlert className="ml-auto size-3.5 shrink-0 text-rose-300/80" aria-label="risky: gets Tier 2" />}
      </div>
      <p className="line-clamp-2 min-h-8 text-[12px] leading-4 text-zinc-300">{u.title}</p>
      <SegmentBar u={u} />
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-zinc-300">
        <Footer u={u} byKey={byKey} now={now} a={a} />
      </div>
    </div>
  )
}

function Footer({ u, byKey, now, a }: { u: UnitView; byKey: Record<string, UnitView>; now: number; a: UnitView["activeAgent"] }) {
  if (u.status === "running" && a) {
    return (
      <>
        <Loader2 className="size-3 shrink-0 animate-spin text-sky-300" />
        <span className="font-mono text-sky-200">{a.role}</span>
        <span className="truncate text-zinc-500">{shortModel(a.model)}</span>
        <span className="ml-auto shrink-0 font-mono tabular-nums text-zinc-300">
          {a.calls ?? 0} calls · {ago(a.startedAt, now)}
        </span>
      </>
    )
  }
  if (u.status === "waiting") {
    const first = byKey[u.waitingOn[0]]
    const WHERE: Partial<Record<UnitView["status"], string>> = { between: "between agents", waiting: "(also queued)", ready: "(not started)", blocked: "(blocked)", stale: "(stale)" }
    const where = first ? (first.status === "running" ? `in ${first.activeAgent?.role ?? first.stage}` : WHERE[first.status] ?? "") : ""
    return (
      <>
        <Hourglass className="size-3 shrink-0 text-amber-300" />
        <span className="truncate">
          waiting on <span className="font-mono text-amber-200">#{first?.n ?? "?"}</span> {where}
          {u.waitingOn.length > 1 && <span className="text-zinc-500"> +{u.waitingOn.length - 1}</span>}
        </span>
      </>
    )
  }
  if (u.status === "merged") {
    return (
      <>
        <GitMerge className="size-3 shrink-0 text-emerald-400" />
        <span className="truncate">{u.outcome || "merged"}</span>
        <span className="ml-auto shrink-0 text-zinc-500">{ago(u.mergedAt ? Date.parse(u.mergedAt) : u.lastActivity, now)}</span>
      </>
    )
  }
  if (u.status === "blocked" || u.status === "stale") {
    return (
      <>
        <TriangleAlert className={cn("size-3 shrink-0", u.status === "blocked" ? "text-red-400" : "text-orange-300")} />
        <span className="truncate">{u.note || u.outcome || STATUS[u.status].label}</span>
      </>
    )
  }
  if (u.status === "between") {
    return (
      <>
        <Clock className="size-3 shrink-0 text-indigo-300" />
        <span className="truncate">{u.note}</span>
      </>
    )
  }
  if (u.status === "ready") return <span className="text-violet-300">ready to launch</span>
  return <span className="truncate">{u.outcome || STATUS[u.status].label}</span>
}

export type RunNodeData = { r: RunView; now: number; selected: boolean }

export function RunNode({ data }: NodeProps & { data: RunNodeData }) {
  const { r, now, selected } = data
  const live = r.state === "running"
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      className={cn(
        "relative flex cursor-pointer flex-col gap-2 rounded-xl border-2 px-3 py-2.5 shadow-lg shadow-black/40",
        live ? "border-sky-500/60 bg-[#101826]" : "border-zinc-600 bg-zinc-900",
        r.integration === "running" && "unit-running",
        selected && "ring-2 ring-white/60",
      )}
    >
      <Handle id="tgt-l" type="target" position={Position.Left} className={hidden} />
      <div className="flex items-center gap-2">
        <Layers className="size-3.5 text-zinc-400" />
        <span className="font-mono text-xs font-semibold text-zinc-100">{r.runId}</span>
        <span className={cn("ml-auto rounded px-1.5 text-[10px] uppercase tracking-wide", live ? "bg-sky-500/15 text-sky-300" : "bg-zinc-700/40 text-zinc-400")}>
          {r.state}
        </span>
      </div>
      <p className="truncate text-[11px] text-zinc-400">{r.name || "workflow run"} · {r.unitKeys.length} unit{r.unitKeys.length === 1 ? "" : "s"}</p>
      <div className={cn("flex h-5 items-center justify-center rounded-[3px] font-mono text-[10px]", SEG[r.integration].cls)}>
        suite + review: {SEG[r.integration].label}
      </div>
      <p className="truncate font-mono text-[10.5px] text-zinc-500">{r.logs.at(-1) || `started ${ago(r.startedAt, now)} ago`}</p>
    </div>
  )
}

export type LaneNodeData = { title: string; hint: string; count: number; height: number; width: number }

export function LaneNode({ data }: NodeProps & { data: LaneNodeData }) {
  return (
    <div style={{ width: data.width, height: data.height }} className="pointer-events-none rounded-xl border border-white/[0.06] bg-white/[0.025]">
      <div className="flex items-baseline gap-2 px-4 pt-3">
        <span className="text-sm font-semibold tracking-tight text-zinc-200">{data.title}</span>
        <span className="font-mono text-xs text-zinc-500">{data.count}</span>
      </div>
      <p className="px-4 text-[11px] text-zinc-500">{data.hint}</p>
    </div>
  )
}

export type MoreNodeData = { count: number; onClick: () => void }

export function MoreNode({ data }: NodeProps & { data: MoreNodeData }) {
  return (
    <button
      onClick={data.onClick}
      style={{ width: NODE_W }}
      className="flex h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-700/40 text-xs text-emerald-300/80 hover:bg-emerald-950/30"
    >
      <GitMerge className="size-3.5" /> +{data.count} earlier merged · show all
    </button>
  )
}

export type MainNodeData = { runs: RunView[]; merged: number; total: number; width: number; height: number }

export function MainNode({ data }: NodeProps & { data: MainNodeData }) {
  const pct = data.total ? Math.round((data.merged / data.total) * 100) : 0
  return (
    <div style={{ width: data.width, height: data.height }} className="flex flex-col justify-center gap-2 rounded-2xl border-2 border-emerald-500/40 bg-[#0b1712] px-4 shadow-xl shadow-black/40">
      <Handle id="tgt-t" type="target" position={Position.Top} className={hidden} />
      <Handle id="tgt-l" type="target" position={Position.Left} className={hidden} />
      <div className="flex items-center gap-2">
        <GitBranch className="size-4 text-emerald-400" />
        <span className="font-mono text-sm font-semibold text-zinc-100">main</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-zinc-400">{data.merged}/{data.total} merged</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-1000" style={{ width: pct + "%" }} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {data.runs.length === 0 && <span className="text-[11px] text-zinc-500">no runs live</span>}
        {data.runs.map((r) => (
          <span key={r.runId} className={cn("rounded px-1.5 font-mono text-[10px]", SEG[r.integration].cls)}>
            {r.runId} · suite {SEG[r.integration].label}
          </span>
        ))}
      </div>
    </div>
  )
}

export const nodeTypes = { unit: UnitNode, run: RunNode, lane: LaneNode, more: MoreNode, main: MainNode }
