"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowDownToLine, ChevronRight, ClipboardCheck, FilePen, FileText, Globe, ListTodo, Loader2, MessageSquare, ScrollText, Search, Terminal, Wrench,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ago, dur, shortModel } from "@/lib/status"
import type { AgentView, LogEvent } from "@/lib/types"

const POLL_MS = 2000

const ICON: Record<string, typeof Terminal> = {
  Bash: Terminal, Read: FileText, Edit: FilePen, MultiEdit: FilePen, Write: FilePen, Grep: Search, Glob: Search, WebFetch: Globe, TodoWrite: ListTodo,
}

const clock = (t: number | null, start: number | null) => {
  if (!t || !start) return ""
  const s = Math.max(0, Math.round((t - start) / 1000))
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function Row({ e, start, open, onToggle }: { e: LogEvent; start: number | null; open: boolean; onToggle: () => void }) {
  const Icon = e.kind === "prompt" ? ScrollText : e.kind === "text" ? MessageSquare : e.kind === "report" ? ClipboardCheck : ICON[e.tool || ""] || Wrench
  const expandable = !!(e.detail || e.output)
  return (
    <li className={cn("group border-l-2 pl-3", e.error ? "border-red-500/70" : e.kind === "report" ? "border-emerald-500/60" : e.pending ? "border-sky-400/70" : "border-transparent")}>
      <button
        onClick={expandable ? onToggle : undefined}
        className={cn("flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left", expandable && "hover:bg-white/[0.04]")}
      >
        <span className="w-12 shrink-0 pt-0.5 text-right font-mono text-[11px] tabular-nums text-zinc-600">{clock(e.t, start)}</span>
        <Icon className={cn("mt-0.5 size-4 shrink-0", e.error ? "text-red-400" : e.kind === "text" ? "text-zinc-400" : e.kind === "report" ? "text-emerald-400" : "text-sky-300")} />
        {e.kind === "tool" && <span className="shrink-0 pt-px font-mono text-xs font-semibold text-zinc-300">{e.tool}</span>}
        <span className={cn("min-w-0 flex-1 pt-px", e.kind === "text" ? "whitespace-pre-wrap text-[13px] leading-5 text-zinc-300" : "truncate font-mono text-xs text-zinc-200", open && e.kind !== "text" && "whitespace-pre-wrap break-all")}>
          {e.title}
        </span>
        {e.pending && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-sky-300" />}
        {e.error && <span className="shrink-0 rounded bg-red-500/15 px-1.5 text-[10px] uppercase text-red-300">error</span>}
        {e.ms != null && <span className="shrink-0 pt-px font-mono text-[11px] tabular-nums text-zinc-600">{e.ms < 1000 ? e.ms + "ms" : (e.ms / 1000).toFixed(1) + "s"}</span>}
        {expandable && <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 text-zinc-600 transition-transform", open && "rotate-90")} />}
      </button>
      {open && (
        <div className="mb-2 ml-[4.75rem] mr-2 space-y-2">
          {e.detail && <pre className="max-h-80 overflow-auto rounded-md bg-zinc-900 p-3 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-zinc-300">{e.detail}</pre>}
          {e.output != null && (
            <pre className={cn("max-h-[28rem] overflow-auto rounded-md bg-black/50 p-3 font-mono text-[11.5px] leading-5 whitespace-pre-wrap", e.error ? "text-red-200" : "text-zinc-400")}>
              {e.output || "(no output)"}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

// Full-page log for one agent: every step it took, refreshed while it runs
export function LogModal({ agent, runId, onClose }: { agent: AgentView | null; runId: string | null; onClose: () => void }) {
  const [events, setEvents] = useState<LogEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openRows, setOpenRows] = useState<Set<number>>(new Set())
  const [expandAll, setExpandAll] = useState(false)
  const [follow, setFollow] = useState(true)
  const scroller = useRef<HTMLDivElement | null>(null)
  const id = agent?.id
  const running = agent?.state === "running"

  useEffect(() => { setEvents(null); setError(null); setOpenRows(new Set()); setFollow(true) }, [id])

  useEffect(() => {
    if (!id || !runId) return
    let stop = false
    const load = async () => {
      try {
        const res = await fetch(`/api/agent?run=${encodeURIComponent(runId)}&agent=${encodeURIComponent(id)}`, { cache: "no-store" })
        const body = await res.json()
        if (stop) return
        if (!res.ok) { setError(body.error || res.statusText); return }
        setEvents(body.events); setError(null)
      } catch (e) { if (!stop) setError(String(e)) }
    }
    load()
    const t = running ? setInterval(load, POLL_MS) : undefined
    return () => { stop = true; if (t) clearInterval(t) }
  }, [id, runId, running])

  // Keep the newest step in view while following
  useEffect(() => {
    const el = scroller.current
    if (el && follow) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [events?.length, follow])

  const start = events?.[0]?.t ?? agent?.startedAt ?? null
  const isOpen = (e: LogEvent) => expandAll || openRows.has(e.i) || e.kind === "report" || (e.error && !openRows.has(-e.i - 1))
  const toggle = (e: LogEvent) => setOpenRows((prev) => {
    const next = new Set(prev)
    if (isOpen(e)) { next.delete(e.i); if (e.error) next.add(-e.i - 1) } else { next.add(e.i); next.delete(-e.i - 1) }
    return next
  })
  const tools = events?.filter((e) => e.kind === "tool").length ?? 0
  const errors = events?.filter((e) => e.error).length ?? 0

  return (
    <Dialog open={!!agent} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[86vh] w-[88vw] max-w-[1400px] flex-col gap-0 overflow-hidden border-white/10 bg-zinc-950 p-0 sm:max-w-[1400px]">
        {agent && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-5 py-3.5 pr-12">
              <div className="flex items-center gap-2.5">
                {running ? <Loader2 className="size-4 animate-spin text-sky-300" /> : <span className={cn("size-2.5 rounded-full", agent.state === "failed" ? "bg-red-400" : "bg-emerald-400")} />}
                <DialogTitle className="font-mono text-base">{agent.label}</DialogTitle>
              </div>
              <DialogDescription className="flex flex-wrap gap-x-3 font-mono text-xs text-zinc-500">
                <span>{agent.phase}</span>
                {agent.model && <span>{shortModel(agent.model)}</span>}
                <span>{tools} tool calls</span>
                {agent.tokens != null && <span>{Math.round(agent.tokens / 1000)}k tok</span>}
                <span>{running ? ago(agent.startedAt) + " so far" : dur(agent.startedAt, agent.endedAt)}</span>
                {errors > 0 && <span className="text-red-300">{errors} {errors === 1 ? "error" : "errors"}</span>}
                {!running && agent.verdict && <span className={agent.verdict === "refuted" || agent.verdict === "blocked" ? "text-amber-300" : "text-emerald-300"}>{agent.verdict}</span>}
              </DialogDescription>
              <div className="ml-auto flex items-center gap-4 text-xs text-zinc-400">
                <label className="flex cursor-pointer items-center gap-2"><Switch checked={expandAll} onCheckedChange={setExpandAll} /> expand all</label>
                <label className="flex cursor-pointer items-center gap-2"><Switch checked={follow} onCheckedChange={setFollow} /> follow</label>
              </div>
            </div>
            <div
              ref={scroller}
              className="flex-1 overflow-auto px-3 py-3"
              onWheel={(ev) => { if (ev.deltaY < 0) setFollow(false) }}
            >
              {error && <p className="p-6 text-sm text-zinc-500">No transcript on disk for this agent ({error}).</p>}
              {!error && !events && <p className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="size-4 animate-spin" /> loading transcript</p>}
              {events && (
                <ol className="space-y-0.5">
                  {events.map((e) => <Row key={e.i} e={e} start={start} open={!!isOpen(e)} onToggle={() => toggle(e)} />)}
                </ol>
              )}
            </div>
            <div className="flex items-center gap-3 border-t border-white/10 px-5 py-2 font-mono text-[11px] text-zinc-500">
              <span>{events?.length ?? 0} steps</span>
              {running && <span className="flex items-center gap-1.5"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> live · every {POLL_MS / 1000}s</span>}
              {!follow && (
                <button onClick={() => setFollow(true)} className="ml-auto flex items-center gap-1.5 text-sky-300 hover:text-sky-200">
                  <ArrowDownToLine className="size-3.5" /> jump to latest
                </button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
