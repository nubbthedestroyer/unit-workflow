import dagre from "@dagrejs/dagre"
import { MarkerType, type Edge, type Node } from "@xyflow/react"
import type { StateResponse, UnitView } from "@/lib/types"
import { NODE_H, NODE_W } from "./nodes"

// Merged units drop out of the flowchart a day after they merge, unless something still on the chart depends on them
const KEEP_MERGED_MS = 24 * 3600_000
const MAIN_W = 340
const MAIN_H = 96

export function edgeStyle(blocker: UnitView) {
  const s = blocker.status
  if (s === "running" || s === "between") return { stroke: "#38bdf8", animated: true, width: 2, dash: undefined }
  if (s === "waiting" || s === "ready") return { stroke: "#fbbf24", animated: true, width: 1.6, dash: "6 4" }
  if (s === "blocked" || s === "stale") return { stroke: "#f87171", animated: false, width: 1.8, dash: "4 3" }
  return { stroke: "#52525b", animated: false, width: 1.2, dash: undefined }
}

const mergedAt = (u: UnitView) => Date.parse(u.mergedAt || "") || u.lastActivity || 0

// Which units belong on the chart. Depends only on the plan and slow-moving merge age, so the chart stays put while cards change
export function flowUnits(data: StateResponse, showAll: boolean) {
  if (showAll) return { units: data.units, hidden: 0 }
  const now = data.generatedAt
  const open = data.units.filter((u) => u.status !== "merged")
  const needed = new Set(open.flatMap((u) => u.deps))
  const keep = data.units.filter((u) => u.status !== "merged" || needed.has(u.key) || now - mergedAt(u) < KEEP_MERGED_MS)
  // Always show some history when nothing is open
  if (keep.length < 4) {
    const recent = data.units.filter((u) => u.status === "merged").sort((a, b) => mergedAt(b) - mergedAt(a)).slice(0, 5)
    for (const u of recent) if (!keep.includes(u)) keep.push(u)
  }
  return { units: keep, hidden: data.units.length - keep.length }
}

export type Positions = Map<string, { x: number; y: number }>

// Static structure: dependency tree top to bottom, every finished branch flowing into main
export function structureKey(units: UnitView[]) {
  const keys = new Set(units.map((u) => u.key))
  return units.map((u) => u.key + (u.status === "deferred" ? "~" : "") + "<" + u.deps.filter((d) => keys.has(d)).join(",")).sort().join("|")
}

// The chart follows the pane's shape: a tall pane gets a top-to-bottom tree, a wide pane a left-to-right one.
// Units with no dependencies wrap into a grid whose column count is picked so the whole chart matches the pane's aspect ratio.
export type Dir = "TB" | "LR"
const GAP_X = 36
const GAP_Y = 44
const RANK_GAP = 64
const SECTION_GAP = 72

export const dirFor = (aspect: number): Dir => (aspect >= 1.2 ? "LR" : "TB")

export function layoutStructure(units: UnitView[], aspect: number): Positions {
  const dir = dirFor(aspect)
  const sorted = [...units].sort((a, b) => (parseInt(a.n) || 0) - (parseInt(b.n) || 0) || a.n.localeCompare(b.n))
  const keys = new Set(sorted.map((u) => u.key))
  const linked = new Set<string>()
  for (const u of sorted) for (const d of u.deps) if (keys.has(d)) { linked.add(d); linked.add(u.key) }

  const pos: Positions = new Map()
  let treeW = 0
  let treeH = 0
  if (linked.size) {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: dir, nodesep: dir === "TB" ? GAP_X : GAP_Y, ranksep: RANK_GAP, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const u of sorted) if (linked.has(u.key)) g.setNode(u.key, { width: NODE_W, height: NODE_H })
    for (const u of sorted) for (const d of u.deps) if (keys.has(d)) g.setEdge(d, u.key)
    dagre.layout(g)
    treeW = g.graph().width || 0
    treeH = g.graph().height || 0
    for (const id of g.nodes()) { const n = g.node(id); pos.set(id, { x: n.x - n.width / 2, y: n.y - n.height / 2 }) }
  }

  // Main sits after the tree in the flow direction
  const mainSpanW = dir === "LR" ? MAIN_W + RANK_GAP : 0
  const mainSpanH = dir === "TB" ? MAIN_H + SECTION_GAP : 0
  const loose = sorted.filter((u) => !linked.has(u.key))
  const gridSize = (c: number) => {
    const rows = Math.ceil(loose.length / c)
    return { w: c * NODE_W + (c - 1) * GAP_X, h: rows * NODE_H + (rows - 1) * GAP_Y }
  }
  let cols = 1
  if (loose.length) {
    let best = Infinity
    for (let c = 1; c <= loose.length; c++) {
      const gs = gridSize(c)
      const w = Math.max(treeW + mainSpanW, gs.w + (dir === "LR" && !treeW ? mainSpanW : 0))
      const h = treeH + (treeH ? SECTION_GAP : 0) + gs.h + mainSpanH
      const score = Math.abs(Math.log(w / h) - Math.log(aspect))
      if (score < best - 1e-9) { best = score; cols = c }
    }
  }
  const grid = loose.length ? gridSize(cols) : { w: 0, h: 0 }

  // Center the tree and the grid against each other, then place main
  const bodyW = Math.max(treeW, grid.w)
  const treeOff = (bodyW - treeW) / 2
  for (const [k, p] of pos) pos.set(k, { x: p.x + treeOff, y: p.y })
  const gridTop = treeH ? treeH + SECTION_GAP : 0
  const gridLeft = (bodyW - grid.w) / 2
  loose.forEach((u, i) => pos.set(u.key, {
    x: gridLeft + (i % cols) * (NODE_W + GAP_X), y: gridTop + Math.floor(i / cols) * (NODE_H + GAP_Y),
  }))
  const bodyH = gridTop + grid.h
  if (dir === "TB") pos.set("main", { x: (bodyW - MAIN_W) / 2, y: bodyH + SECTION_GAP })
  else pos.set("main", { x: bodyW + RANK_GAP, y: ((treeH || bodyH) - MAIN_H) / 2 })
  return pos
}

export function buildFlow(
  data: StateResponse, units: UnitView[], hidden: number, pos: Positions, dir: Dir, flashes: Set<string>, selected: string | null,
  expand: () => void,
) {
  const [sh, th] = dir === "TB" ? ["src-b", "tgt-t"] : ["src-r", "tgt-l"]
  const byKey = Object.fromEntries(data.units.map((u) => [u.key, u]))
  const keys = new Set(units.map((u) => u.key))
  const nodes: Node[] = []
  for (const u of units) {
    const p = pos.get(u.key)
    if (!p) continue
    nodes.push({
      id: u.key, type: "unit", position: p, draggable: false,
      data: { u, byKey, now: data.generatedAt, flash: flashes.has(u.key), selected: selected === u.key },
    })
  }
  const live = data.runs.filter((r) => r.state === "running")
  const counts = { merged: units.filter((u) => u.status === "merged").length, total: units.filter((u) => u.status !== "deferred").length }
  const mp = pos.get("main")
  if (mp) nodes.push({ id: "main", type: "main", position: mp, draggable: false, selectable: false, data: { runs: live, ...counts, width: MAIN_W, height: MAIN_H } })
  if (hidden) {
    const top = Math.min(...[...pos.values()].map((p) => p.y))
    const left = Math.min(...[...pos.values()].map((p) => p.x))
    nodes.push({ id: "more-merged", type: "more", draggable: false, selectable: false, position: { x: left, y: top - 70 }, data: { count: hidden, onClick: expand } })
  }

  const edges: Edge[] = []
  const hasChild = new Set<string>()
  for (const u of units) for (const d of u.deps) {
    if (!keys.has(d)) continue
    hasChild.add(d)
    const s = edgeStyle(byKey[d])
    edges.push({
      id: `dep-${d}-${u.key}`, source: d, target: u.key, sourceHandle: sh, targetHandle: th, type: "smoothstep",
      animated: s.animated, style: { stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dash, opacity: byKey[d].status === "merged" ? 0.5 : 0.95 },
      markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 16, height: 16 },
    })
  }
  const linked = new Set([...hasChild, ...units.filter((u) => u.deps.some((d) => keys.has(d))).map((u) => u.key)])
  for (const u of units) {
    if (hasChild.has(u.key) || u.status === "deferred") continue
    if (!linked.has(u.key) && u.status === "merged") continue
    const done = u.status === "merged"
    const moving = u.status === "running" || u.status === "between"
    const stroke = done ? "#34d399" : moving ? "#38bdf8" : "#52525b"
    edges.push({
      id: `main-${u.key}`, source: u.key, target: "main", sourceHandle: sh, targetHandle: th, type: "smoothstep",
      animated: moving, style: { stroke, strokeWidth: done ? 1.6 : 1.2, strokeDasharray: done ? undefined : "4 4", opacity: done ? 0.7 : 0.6 },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
    })
  }
  return { nodes, edges }
}
