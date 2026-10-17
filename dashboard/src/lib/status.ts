import type { SegState, Stage, UnitStatus } from "./types"

export const COLUMNS: { stage: Stage | "integration"; title: string; hint: string }[] = [
  { stage: "queued", title: "Queued", hint: "waiting on a dependency, or ready to launch" },
  { stage: "port", title: "Port", hint: "build in its own worktree" },
  { stage: "tier1", title: "Tier 1", hint: "verify, with up to 2 fix rounds" },
  { stage: "tier2", title: "Tier 2", hint: "refute-only pass, risky units" },
  { stage: "merge", title: "Merge", hint: "one at a time into main" },
  { stage: "merged", title: "Merged", hint: "on main" },
  { stage: "integration", title: "Integration", hint: "suite + review, once per run" },
]

export const STATUS: Record<UnitStatus, { label: string; node: string; badge: string; dot: string }> = {
  running: {
    label: "Running",
    node: "border-sky-400/80 bg-[#0c1a2b] unit-running",
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/40",
    dot: "bg-sky-400",
  },
  between: {
    label: "Between agents",
    node: "border-indigo-400/60 bg-[#141530]",
    badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
    dot: "bg-indigo-400",
  },
  waiting: {
    label: "Waiting on",
    node: "border-amber-400/60 border-dashed bg-[#1e1709]",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    dot: "bg-amber-400",
  },
  ready: {
    label: "Ready",
    node: "border-violet-400/60 bg-[#191326]",
    badge: "bg-violet-500/15 text-violet-300 border-violet-500/40",
    dot: "bg-violet-400",
  },
  merged: {
    label: "Merged",
    node: "border-emerald-500/40 bg-[#0d1a15]",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    dot: "bg-emerald-400",
  },
  blocked: {
    label: "Blocked",
    node: "border-red-500/80 bg-[#250f12]",
    badge: "bg-red-500/15 text-red-300 border-red-500/40",
    dot: "bg-red-400",
  },
  stale: {
    label: "Stale",
    node: "border-orange-400/70 border-dashed bg-[#22140b]",
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/40",
    dot: "bg-orange-400",
  },
  deferred: {
    label: "Deferred",
    node: "border-zinc-700 bg-zinc-900 opacity-60",
    badge: "bg-zinc-500/15 text-zinc-400 border-zinc-500/40",
    dot: "bg-zinc-500",
  },
}

export const SEG: Record<SegState, { label: string; cls: string }> = {
  pending: { label: "pending", cls: "bg-zinc-800 text-zinc-400" },
  running: { label: "running", cls: "bg-sky-500 text-sky-950 seg-stripes" },
  done: { label: "done", cls: "bg-emerald-500/80 text-emerald-950" },
  fix: { label: "fix round", cls: "bg-amber-500 text-amber-950 seg-stripes" },
  failed: { label: "failed", cls: "bg-red-500 text-red-950" },
  skipped: { label: "skipped", cls: "seg-hatch text-zinc-600" },
}

export const SEGMENTS = [
  { k: "port", short: "Port" },
  { k: "tier1", short: "T1" },
  { k: "tier2", short: "T2" },
  { k: "merge", short: "Merge" },
  { k: "integration", short: "Int" },
] as const

export function ago(ms: number | null | undefined, now = Date.now()) {
  if (!ms) return ""
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return s + "s"
  const m = Math.round(s / 60)
  if (m < 60) return m + "m"
  const h = Math.round(m / 60)
  if (h < 48) return h + "h"
  return Math.round(h / 24) + "d"
}

export function dur(a: number | null, b: number | null) {
  if (!a || !b) return ""
  return ago(a, b)
}

export const shortModel = (m: string) => m.replace(/^claude-/, "").replace(/-(\d)-(\d)$/, " $1.$2")
