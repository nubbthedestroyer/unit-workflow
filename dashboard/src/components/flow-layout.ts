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

// The layout is chosen to make the cards as large as possible in the pane. Every candidate is tried:
// - the dependency tree left-to-right or top-to-bottom,
// - long chains wrapped into rows (or columns) after k ranks, like lines of text,
// - units with no dependencies in a grid of any width under the tree,
// and the one with the highest fit zoom for the pane's aspect ratio wins. main is the tree's last rank.
export type Dir = "TB" | "LR"
export interface Layout { pos: Positions; dir: Dir; band: Map<string, number> }
const GAP_X = 36
const GAP_Y = 44
const RANK_GAP = 64
const BAND_GAP = 72
const SECTION_GAP = 72
const WRAP_PENALTY = 0.97 // a tie goes to fewer wraps

type Box = { w: number; h: number }
const boxOf = (id: string): Box => (id === "main" ? { w: MAIN_W, h: MAIN_H } : { w: NODE_W, h: NODE_H })

function treeLayout(sorted: UnitView[], linked: Set<string>, keys: Set<string>, dir: Dir) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: dir, nodesep: dir === "TB" ? GAP_X : GAP_Y, ranksep: RANK_GAP, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  const hasChild = new Set<string>()
  for (const u of sorted) if (linked.has(u.key)) g.setNode(u.key, { width: NODE_W, height: NODE_H })
  g.setNode("main", { width: MAIN_W, height: MAIN_H })
  for (const u of sorted) for (const d of u.deps) if (keys.has(d)) { g.setEdge(d, u.key); hasChild.add(d) }
  for (const u of sorted) if (linked.has(u.key) && !hasChild.has(u.key) && u.status !== "deferred") g.setEdge(u.key, "main")
  dagre.layout(g)
  // Rank = position along the flow axis; cross = position across it
  const centers = [...new Set(g.nodes().map((id) => Math.round(dir === "LR" ? g.node(id).x : g.node(id).y)))].sort((a, b) => a - b)
  const nodes = g.nodes().map((id) => {
    const n = g.node(id)
    return { id, rank: centers.indexOf(Math.round(dir === "LR" ? n.x : n.y)), along: dir === "LR" ? n.x : n.y, cross: dir === "LR" ? n.y : n.x, box: boxOf(id) }
  })
  const crossSpan = (dir === "LR" ? g.graph().height : g.graph().width) || 0
  return { nodes, ranks: centers.length, crossSpan, centers }
}

// Wrap a tree after k ranks; returns top-left positions, bands and the bounding size
function wrapTree(t: ReturnType<typeof treeLayout>, dir: Dir, k: number) {
  const pos: Positions = new Map()
  const band = new Map<string, number>()
  let w = 0, h = 0
  for (const n of t.nodes) {
    const b = Math.floor(n.rank / k)
    const along = n.along - t.centers[b * k] // restart the flow axis in each band
    const cross = n.cross + b * (t.crossSpan + BAND_GAP)
    const [cx, cy] = dir === "LR" ? [along, cross] : [cross, along]
    const x = cx - n.box.w / 2 + (dir === "LR" ? NODE_W / 2 : 0), y = cy - n.box.h / 2 + (dir === "TB" ? NODE_H / 2 : 0)
    pos.set(n.id, { x, y }); band.set(n.id, b)
    w = Math.max(w, x + n.box.w); h = Math.max(h, y + n.box.h)
  }
  return { pos, band, w, h }
}

const gridSize = (n: number, c: number) => {
  const rows = Math.ceil(n / c)
  return { w: c * NODE_W + (c - 1) * GAP_X, h: rows * NODE_H + (rows - 1) * GAP_Y }
}

export function layoutStructure(units: UnitView[], aspect: number): Layout {
  const sorted = [...units].sort((a, b) => (parseInt(a.n) || 0) - (parseInt(b.n) || 0) || a.n.localeCompare(b.n))
  const keys = new Set(sorted.map((u) => u.key))
  const linked = new Set<string>()
  for (const u of sorted) for (const d of u.deps) if (keys.has(d)) { linked.add(d); linked.add(u.key) }
  const loose = sorted.filter((u) => !linked.has(u.key))
  // Fit zoom up to a constant: the pane is aspect wide and 1 tall
  const score = (w: number, h: number) => Math.min(aspect / w, 1 / h)

  let best = { s: -1, dir: "TB" as Dir, tree: null as ReturnType<typeof wrapTree> | null, cols: 1 }
  const tryGrid = (dir: Dir, tree: ReturnType<typeof wrapTree> | null, penalty: number) => {
    const n = loose.length
    for (let c = 1; c <= Math.max(1, n); c++) {
      const g = n ? gridSize(n, c) : { w: 0, h: 0 }
      const mainH = tree ? 0 : MAIN_H + SECTION_GAP
      const w = Math.max(tree?.w || 0, g.w, tree ? 0 : MAIN_W)
      const h = (tree?.h || 0) + (tree && n ? SECTION_GAP : 0) + g.h + mainH
      const s = score(w, h) * penalty
      if (s > best.s + 1e-12) best = { s, dir, tree, cols: c }
    }
  }
  if (linked.size) {
    for (const dir of ["LR", "TB"] as Dir[]) {
      const t = treeLayout(sorted, linked, keys, dir)
      for (let k = 1; k <= t.ranks; k++) tryGrid(dir, wrapTree(t, dir, k), Math.pow(WRAP_PENALTY, Math.ceil(t.ranks / k) - 1))
    }
  } else tryGrid("TB", null, 1)

  const { tree, cols, dir } = best
  const pos: Positions = new Map()
  const band = new Map<string, number>(tree?.band || [])
  const grid = loose.length ? gridSize(loose.length, cols) : { w: 0, h: 0 }
  const bodyW = Math.max(tree?.w || 0, grid.w, tree ? 0 : MAIN_W)
  const treeOff = (bodyW - (tree?.w || 0)) / 2
  for (const [k, p] of tree?.pos || []) pos.set(k, { x: p.x + treeOff, y: p.y })
  const gridTop = tree ? tree.h + (loose.length ? SECTION_GAP : 0) : 0
  const gridLeft = (bodyW - grid.w) / 2
  loose.forEach((u, i) => pos.set(u.key, { x: gridLeft + (i % cols) * (NODE_W + GAP_X), y: gridTop + Math.floor(i / cols) * (NODE_H + GAP_Y) }))
  if (!tree) pos.set("main", { x: (bodyW - MAIN_W) / 2, y: grid.h + SECTION_GAP })
  return { pos, dir, band }
}

export function buildFlow(
  data: StateResponse, units: UnitView[], hidden: number, layout: Layout, flashes: Set<string>, selected: string | null,
  expand: () => void,
) {
  const { pos, dir, band } = layout
  // Same row: along the flow. Wrapping to the next row: out the bottom (or side) and into the start of the next one
  const handles = (a: string, b: string) => {
    const wrap = (band.get(a) ?? 0) !== (band.get(b) ?? 0)
    return (dir === "LR") !== wrap ? { sourceHandle: "src-r", targetHandle: "tgt-l" } : { sourceHandle: "src-b", targetHandle: "tgt-t" }
  }
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
      id: `dep-${d}-${u.key}`, source: d, target: u.key, ...handles(d, u.key), type: "smoothstep",
      animated: s.animated, style: { stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dash, opacity: byKey[d].status === "merged" ? 0.5 : 0.95 },
      markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 16, height: 16 },
    })
  }
  const linked = new Set([...hasChild, ...units.filter((u) => u.deps.some((d) => keys.has(d))).map((u) => u.key)])
  for (const u of units) {
    if (hasChild.has(u.key) || u.status === "deferred") continue
    if (!linked.has(u.key)) continue
    const done = u.status === "merged"
    const moving = u.status === "running" || u.status === "between"
    const stroke = done ? "#34d399" : moving ? "#38bdf8" : "#52525b"
    edges.push({
      id: `main-${u.key}`, source: u.key, target: "main", ...handles(u.key, "main"), type: "smoothstep",
      animated: moving, style: { stroke, strokeWidth: done ? 1.6 : 1.2, strokeDasharray: done ? undefined : "4 4", opacity: done ? 0.7 : 0.6 },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
    })
  }
  return { nodes, edges }
}
