"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Background, BackgroundVariant, MarkerType, Panel, ReactFlow, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Columns3, GitFork, Workflow } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { COLUMNS, SEG, STATUS, ago } from "@/lib/status"
import type { RunView, StateResponse, UnitStatus, UnitView } from "@/lib/types"
import { NODE_H, NODE_W, nodeTypes } from "./nodes"
import { DetailSheet } from "./detail-sheet"
import { ZoomPanel } from "./zoom-panel"
import { buildFlow, dirFor, edgeStyle, flowUnits, layoutStructure, structureKey } from "./flow-layout"

const POLL_MS = 3000
const COL_W = NODE_W + 40
const ROW_H = NODE_H + 22
const TOP = 72
const RECENT_MERGED = 5
const RUN_LINGER_MS = 15 * 60_000

const num = (n: string) => { const v = parseInt(n, 10); return Number.isNaN(v) ? Infinity : v }
const byN = (a: UnitView, b: UnitView) => num(a.n) - num(b.n) || a.n.localeCompare(b.n)
const colOf = (stage: string) => COLUMNS.findIndex((c) => c.stage === stage)

// Order the Queued lane so blockers sit above the units waiting on them
function depthOrder(units: UnitView[], byKey: Record<string, UnitView>) {
  const memo = new Map<string, number>()
  const depth = (u: UnitView, seen = new Set<string>()): number => {
    if (memo.has(u.key)) return memo.get(u.key)!
    if (seen.has(u.key)) return 0
    seen.add(u.key)
    const d = Math.max(0, ...u.waitingOn.map((k) => (byKey[k] && byKey[k].stage === "queued" ? depth(byKey[k], seen) + 1 : 0)))
    memo.set(u.key, d)
    return d
  }
  const rank = (u: UnitView) => (u.status === "waiting" ? 0 : u.status === "ready" ? 2 : 1)
  return [...units].sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b) || byN(a, b))
}


function layout(
  data: StateResponse, showAll: boolean, now: number, flashes: Set<string>, selected: string | null, expand: () => void,
) {
  const byKey = Object.fromEntries(data.units.map((u) => [u.key, u]))
  const liveRuns = data.runs.filter((r) => r.state === "running" || now - (r.lastActivity || 0) < RUN_LINGER_MS)
  const liveRunIds = new Set(liveRuns.map((r) => r.runId))

  // Merged history collapses to the most recent few, plus anything a visible unit depends on or a live run carries
  let visible = data.units
  let hiddenMerged = 0
  if (!showAll) {
    const active = data.units.filter((u) => u.status !== "merged")
    const merged = data.units.filter((u) => u.status === "merged")
      .sort((a, b) => (Date.parse(b.mergedAt || "") || b.lastActivity || 0) - (Date.parse(a.mergedAt || "") || a.lastActivity || 0))
    const keep = new Set(merged.slice(0, RECENT_MERGED).map((u) => u.key))
    for (const u of active) for (const d of u.deps) keep.add(d)
    for (const u of merged) if (u.runId && liveRunIds.has(u.runId)) keep.add(u.key)
    visible = [...active, ...merged.filter((u) => keep.has(u.key))]
    hiddenMerged = merged.length - merged.filter((u) => keep.has(u.key)).length
  }

  const cols: UnitView[][] = COLUMNS.map(() => [])
  for (const u of visible) cols[colOf(u.stage)].push(u)
  cols[0] = depthOrder(cols[0], byKey)
  for (let i = 1; i < cols.length; i++) cols[i].sort(byN)
  const runsShown = liveRuns.filter((r) => r.unitKeys.some((k) => visible.some((u) => u.key === k)))

  const rows = Math.max(2, ...cols.map((c) => c.length), runsShown.length, cols[5].length + (hiddenMerged ? 1 : 0))
  const laneH = TOP + rows * ROW_H + 24
  const nodes: Node[] = COLUMNS.map((c, i) => ({
    id: "lane-" + c.stage, type: "lane", position: { x: i * COL_W - 20, y: 0 }, draggable: false, selectable: false,
    zIndex: -1, data: { title: c.title, hint: c.hint, count: i === 6 ? runsShown.length : cols[i].length, height: laneH, width: COL_W - 16 },
  }))
  const pos = new Map<string, number>()
  cols.forEach((col, i) => col.forEach((u, row) => {
    pos.set(u.key, i)
    nodes.push({
      id: u.key, type: "unit", position: { x: i * COL_W + 8, y: TOP + row * ROW_H }, draggable: false,
      data: { u, byKey, now, flash: flashes.has(u.key), selected: selected === u.key },
    })
  }))
  if (hiddenMerged) nodes.push({
    id: "more-merged", type: "more", draggable: false, selectable: false,
    position: { x: 5 * COL_W + 8, y: TOP + cols[5].length * ROW_H }, data: { count: hiddenMerged, onClick: expand },
  })
  runsShown.forEach((r, row) => nodes.push({
    id: "run-" + r.runId, type: "run", position: { x: 6 * COL_W + 8, y: TOP + row * ROW_H }, draggable: false,
    data: { r, now, selected: selected === "run-" + r.runId },
  }))

  const edges: Edge[] = []
  for (const u of visible) for (const d of u.deps) {
    const b = byKey[d]
    if (!b || !pos.has(d)) continue
    const s = edgeStyle(b)
    const bc = pos.get(d)!, uc = pos.get(u.key)!
    const [sh, th] = bc === uc ? ["src-b", "tgt-t"] : bc > uc ? ["src-l", "tgt-r"] : ["src-r", "tgt-l"]
    edges.push({
      id: `dep-${d}-${u.key}`, source: d, target: u.key, sourceHandle: sh, targetHandle: th, type: "default",
      animated: s.animated, zIndex: 1,
      style: { stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dash, opacity: b.status === "merged" ? 0.45 : 0.95 },
      markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 16, height: 16 },
    })
  }
  for (const r of runsShown) for (const k of r.unitKeys) {
    if (!pos.has(k)) continue
    const u = byKey[k]
    edges.push({
      id: `run-${r.runId}-${k}`, source: k, target: "run-" + r.runId, sourceHandle: "src-r", targetHandle: "tgt-l", type: "smoothstep",
      animated: u.status === "running" || u.status === "between",
      style: { stroke: u.status === "merged" ? "#34d399" : "#71717a", strokeWidth: 1, strokeDasharray: "2 4", opacity: 0.5 },
    })
  }
  return { nodes, edges, byKey }
}

const ORDER: UnitStatus[] = ["running", "between", "waiting", "ready", "blocked", "stale", "merged", "deferred"]

export function Dashboard() {
  const [data, setData] = useState<StateResponse | null>(null)
  const [plan, setPlan] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<"board" | "flow">("board")
  // Pane shape drives the flowchart layout; rounded and debounced so a window drag does not re-lay it on every pixel
  const [aspect, setAspect] = useState(0.6)
  const [paneSize, setPaneSize] = useState("")
  const mainRef = useRef<HTMLElement | null>(null)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      if (!width || !height) return
      setAspect(Math.round((width / height) * 10) / 10)
      setPaneSize(Math.round(width) + "x" + Math.round(height))
    }
    measure()
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(measure, 250) })
    ro.observe(el)
    return () => { ro.disconnect(); clearTimeout(t) }
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(null)
  const [flashes, setFlashes] = useState<Set<string>>(new Set())
  const prev = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      setPlan(q.get("plan"))
      if (q.get("view") === "flow") setView("flow")
    } catch {}
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/state" + (plan ? "?plan=" + encodeURIComponent(plan) : ""), { cache: "no-store" })
      if (!res.ok) throw new Error(res.status + " " + res.statusText)
      const next: StateResponse = await res.json()
      // Flash a unit for a moment whenever its status or stage changes between polls
      const changed = new Set<string>()
      const seen = prev.current.size > 0
      for (const u of next.units) {
        const sig = u.status + "|" + u.stage + "|" + u.activeAgent?.id
        if (seen && prev.current.has(u.key) && prev.current.get(u.key) !== sig) changed.add(u.key)
        prev.current.set(u.key, sig)
      }
      if (changed.size) { setFlashes(changed); setTimeout(() => setFlashes(new Set()), 2400) }
      setData(next)
      setError(null)
    } catch (e) { setError(String(e)) }
  }, [plan])

  useEffect(() => {
    prev.current = new Map()
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const setParam = (k: string, v: string) => {
    try { const u = new URL(window.location.href); u.searchParams.set(k, v); window.history.replaceState(null, "", u) } catch {}
  }
  const pickPlan = (p: string) => { setPlan(p); setSelected(null); setParam("plan", p) }
  const pickView = (v: string) => { setView(v as "board" | "flow"); setParam("view", v) }

  // Flowchart: the structure (which units, which dependencies) is laid out once and only re-laid when it changes; cards update in place
  const flowSet = useMemo(() => (data ? flowUnits(data, showAll) : null), [data, showAll])
  const structKey = flowSet ? structureKey(flowSet.units) : ""
  const flowUnitsRef = useRef<UnitView[]>([])
  if (flowSet) flowUnitsRef.current = flowSet.units
  const positions = useMemo(() => layoutStructure(flowUnitsRef.current, aspect), [structKey, aspect]) // eslint-disable-line react-hooks/exhaustive-deps
  const dir = dirFor(aspect)

  const graph = useMemo(() => {
    if (!data) return null
    if (view === "flow" && flowSet) {
      const f = buildFlow(data, flowSet.units, flowSet.hidden, positions, dir, flashes, selected, () => setShowAll(true))
      return { ...f, byKey: Object.fromEntries(data.units.map((u) => [u.key, u])) }
    }
    return layout(data, showAll, data.generatedAt, flashes, selected, () => setShowAll(true))
  }, [data, showAll, flashes, selected, view, flowSet, positions, dir])
  const counts = useMemo(() => {
    const c: Partial<Record<UnitStatus, number>> = {}
    for (const u of data?.units || []) c[u.status] = (c[u.status] || 0) + 1
    return c
  }, [data])

  // Zoom to fill the pane: as large as fits, capped so cards never get huge; a chart that cannot fit at a readable size
  // starts at its top-left corner and scrolls. Runs on load, on resize, and when the layout changes, never on a data poll
  const fitPane = useCallback((animate: boolean) => {
    const rf = rfRef.current
    const el = mainRef.current
    if (!rf || !el) return
    // Bounds from the sizes the layout assigned, since cards may not be measured yet right after a re-layout
    const nodes = rf.getNodes().filter((n) => n.type !== "more")
    if (!nodes.length) return
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of nodes) {
      const d = n.data as { width?: number; height?: number }
      const w = d.width ?? n.measured?.width ?? NODE_W
      const h = d.height ?? n.measured?.height ?? NODE_H
      x0 = Math.min(x0, n.position.x); y0 = Math.min(y0, n.position.y)
      x1 = Math.max(x1, n.position.x + w); y1 = Math.max(y1, n.position.y + h)
    }
    const b = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    const W = el.clientWidth, H = el.clientHeight, pad = 28, legend = 56, toolbar = 44
    const flow = view === "flow"
    const fitZoom = Math.min((W - 2 * pad) / b.width, (H - 2 * pad - legend - toolbar) / b.height)
    const zoom = Math.max(flow ? 0.5 : 0.3, Math.min(flow ? 2 : 1.4, fitZoom))
    const x = b.width * zoom > W - 2 * pad ? pad - b.x * zoom : (W - b.width * zoom) / 2 - b.x * zoom
    const y = b.height * zoom > H - 2 * pad - legend - toolbar ? pad + toolbar - b.y * zoom : toolbar + (H - legend - toolbar - b.height * zoom) / 2 - b.y * zoom
    rf.setViewport({ x, y, zoom }, { duration: animate ? 450 : 0 })
  }, [view])
  const layoutSig = view === "flow" ? structKey + aspect : (data?.plan || "") + showAll
  useEffect(() => {
    const t = setTimeout(() => fitPane(true), 120)
    return () => clearTimeout(t)
  }, [layoutSig, paneSize, showAll, fitPane])

  const selUnit = data?.units.find((u) => u.key === selected) || null
  const selRun: RunView | null = data?.runs.find((r) => "run-" + r.runId === selected) || null
  const stale = data ? now - data.generatedAt > POLL_MS * 3 : false

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/5 bg-zinc-950/70 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Workflow className="size-5 text-sky-400" />
          <h1 className="text-[15px] font-semibold tracking-tight">Unit workflows</h1>
        </div>
        <Tabs value={view} onValueChange={pickView}>
          <TabsList className="h-8 bg-zinc-900">
            <TabsTrigger value="board" className="h-6 gap-1.5 px-2.5 text-xs"><Columns3 className="size-3.5" /> Board</TabsTrigger>
            <TabsTrigger value="flow" className="h-6 gap-1.5 px-2.5 text-xs"><GitFork className="size-3.5" /> Flowchart</TabsTrigger>
          </TabsList>
        </Tabs>
        {data && data.projects.length > 0 && (
          <Tabs value={data.plan || ""} onValueChange={pickPlan}>
            <TabsList className="h-8 bg-zinc-900">
              {data.projects.map((p) => (
                <TabsTrigger key={p.plan} value={p.plan} className="h-6 gap-1.5 px-2.5 text-xs" title={p.plan}>
                  {p.name}
                  {(["running", "waiting", "blocked"] as UnitStatus[]).map((s) =>
                    p.counts[s] ? <span key={s} className={cn("size-1.5 rounded-full", STATUS[s].dot, s === "running" && "animate-pulse")} /> : null,
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {ORDER.filter((s) => counts[s]).map((s) => (
            <span key={s} className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs", STATUS[s].badge)}>
              <span className={cn("size-1.5 rounded-full", STATUS[s].dot)} />
              {counts[s]} {STATUS[s].label.toLowerCase()}
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs text-zinc-400">
          <label className="flex cursor-pointer items-center gap-2">
            <Switch checked={showAll} onCheckedChange={setShowAll} /> all merged
          </label>
          <span className="flex items-center gap-1.5 font-mono tabular-nums">
            <span className={cn("size-2 rounded-full", error || stale ? "bg-red-500" : "bg-emerald-400 animate-pulse")} />
            {error ? "offline" : data ? `live · ${ago(data.generatedAt, now)} ago` : "loading"}
          </span>
        </div>
      </header>

      <main ref={mainRef} className="relative flex-1">
        {graph && (
          <ReactFlow
            key={(data?.plan || "none") + view}
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            colorMode="dark"
            minZoom={0.15}
            nodesDraggable={false}
            nodesConnectable={false}
            panOnScroll={view === "flow"}
            zoomOnScroll={view !== "flow"}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, n) => (n.type === "unit" || n.type === "run") && setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            onInit={(rf) => { rfRef.current = rf; setTimeout(() => fitPane(false), 60) }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#27272a" />
            <ZoomPanel onFit={() => fitPane(true)} />
            <Panel position="bottom-left">
              <Legend />
            </Panel>
          </ReactFlow>
        )}
        {data && data.units.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-sm text-zinc-500">No units.json found. Set PLAN_DIRS to your plan folders.</div>
        )}
      </main>

      <DetailSheet
        unit={selUnit}
        run={selRun}
        byKey={graph?.byKey || {}}
        runs={data?.runs || []}
        now={now}
        onSelect={setSelected}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

function Legend() {
  return (
    <div className="flex max-w-[560px] flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-white/5 bg-zinc-950/85 px-3 py-2 text-[11px] text-zinc-400 shadow-xl backdrop-blur">
      {(["pending", "running", "done", "fix", "failed", "skipped"] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-5 rounded-[2px]", SEG[s].cls)} />
          {SEG[s].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="#38bdf8" strokeWidth="2" className="edge-flow" /></svg>
        blocker running
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="#fbbf24" strokeWidth="1.6" strokeDasharray="6 4" className="edge-flow" /></svg>
        blocker also waiting
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="#52525b" strokeWidth="1.2" /></svg>
        dependency met
      </span>
    </div>
  )
}
