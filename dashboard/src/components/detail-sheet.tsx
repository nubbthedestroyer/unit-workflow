"use client"

import { Loader2 } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { SEG, STATUS, ago, dur, shortModel } from "@/lib/status"
import type { AgentView, RunView, UnitView } from "@/lib/types"
import { SegmentBar } from "./nodes"

const VERDICT_CLS: Record<string, string> = {
  verified: "text-emerald-300", done: "text-emerald-300", refuted: "text-amber-300", partial: "text-amber-300", blocked: "text-red-300",
}

function AgentRow({ a, now }: { a: AgentView; now: number }) {
  return (
    <li className="rounded-md border border-white/5 bg-zinc-900/60 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        {a.state === "running" ? <Loader2 className="size-3 animate-spin text-sky-300" />
          : <span className={cn("size-2 rounded-full", a.state === "failed" ? "bg-red-400" : "bg-emerald-400")} />}
        <span className="font-mono font-semibold text-zinc-100">{a.label}</span>
        <span className="text-zinc-500">{a.phase}</span>
        <span className={cn("ml-auto font-mono", VERDICT_CLS[a.verdict || ""] || "text-zinc-400")}>
          {a.state === "running" ? "running" : a.state === "failed" ? "failed" : a.verdict}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] tabular-nums text-zinc-500">
        {a.model && <span>{shortModel(a.model)}</span>}
        {a.calls != null && <span>{a.calls} calls</span>}
        {a.tokens != null && <span>{Math.round(a.tokens / 1000)}k tok</span>}
        <span>{a.state === "running" ? ago(a.startedAt, now) : dur(a.startedAt, a.endedAt)}</span>
        {a.lastTool && a.state === "running" && <span>last: {a.lastTool}</span>}
      </div>
      {(a.blockers.length > 0 || (a.verdict === "refuted" && a.findings.length > 0)) && (
        <ul className="mt-1.5 space-y-1 text-[11px] leading-4 text-zinc-400">
          {[...a.blockers, ...(a.verdict === "refuted" ? a.findings : [])].slice(0, 4).map((f, i) => (
            <li key={i} className="border-l-2 border-amber-500/40 pl-2">{f}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

function UnitLink({ u, onSelect }: { u: UnitView; onSelect: (k: string) => void }) {
  return (
    <button onClick={() => onSelect(u.key)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-white/5">
      <span className={cn("size-2 rounded-full", STATUS[u.status].dot)} />
      <span className="font-mono text-zinc-500">#{u.n}</span>
      <span className="truncate font-mono text-zinc-200">{u.key}</span>
      <span className="ml-auto text-zinc-500">{u.status === "running" ? u.activeAgent?.role : STATUS[u.status].label.toLowerCase()}</span>
    </button>
  )
}

export function DetailSheet({ unit, run, byKey, runs, now, onSelect, onClose }: {
  unit: UnitView | null; run: RunView | null; byKey: Record<string, UnitView>; runs: RunView[]; now: number
  onSelect: (id: string) => void; onClose: () => void
}) {
  const unblocks = unit ? Object.values(byKey).filter((u) => u.deps.includes(unit.key)) : []
  const unitRun = unit ? runs.find((r) => r.runId === unit.runId) : null
  return (
    <Sheet open={!!(unit || run)} onOpenChange={(o) => !o && onClose()} modal={false}>
      <SheetContent className="w-[440px] gap-0 border-white/10 bg-zinc-950 p-0 sm:max-w-[440px]" onInteractOutside={(e) => e.preventDefault()}>
        <ScrollArea className="h-full">
          {unit && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0">
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-md border px-2 py-0.5 text-xs", STATUS[unit.status].badge)}>{STATUS[unit.status].label}</span>
                  {unit.risky && <span className="rounded-md border border-rose-500/30 px-2 py-0.5 text-xs text-rose-300">risky · Tier 2</span>}
                  <span className="ml-auto pr-8 font-mono text-xs text-zinc-500">units.json: {unit.registryStatus}</span>
                </div>
                <SheetTitle className="font-mono text-base">#{unit.n} {unit.key}</SheetTitle>
                <SheetDescription>{unit.title}</SheetDescription>
              </SheetHeader>
              <SegmentBar u={unit} big />
              {unit.note && <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">{unit.note}</p>}
              {unit.outcome && <p className="text-xs leading-5 text-zinc-400"><span className="text-zinc-500">Outcome · </span>{unit.outcome}</p>}

              {(unit.deps.length > 0 || unblocks.length > 0) && (
                <div className="grid gap-3">
                  {unit.deps.length > 0 && (
                    <div>
                      <h4 className="mb-1 text-xs font-medium text-zinc-400">Queued behind</h4>
                      {unit.deps.map((k) => byKey[k] && <UnitLink key={k} u={byKey[k]} onSelect={onSelect} />)}
                    </div>
                  )}
                  {unblocks.length > 0 && (
                    <div>
                      <h4 className="mb-1 text-xs font-medium text-zinc-400">Unblocks</h4>
                      {unblocks.map((u) => <UnitLink key={u.key} u={u} onSelect={onSelect} />)}
                    </div>
                  )}
                </div>
              )}

              <Separator className="bg-white/5" />
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <h4 className="font-medium text-zinc-300">Agents</h4>
                  {unit.runId && (
                    <button onClick={() => onSelect("run-" + unit.runId)} className="ml-auto font-mono text-zinc-500 hover:text-zinc-300">
                      {unit.runId} · {unit.runState || "no run on disk"}
                    </button>
                  )}
                </div>
                {unit.agents.length ? (
                  <ol className="space-y-1.5">{unit.agents.map((a) => <AgentRow key={a.id} a={a} now={now} />)}</ol>
                ) : (
                  <p className="text-xs text-zinc-500">No agent history on disk for this unit.</p>
                )}
                {unitRun?.suite && <ol className="mt-1.5 space-y-1.5"><AgentRow a={unitRun.suite} now={now} />{unitRun.review && <AgentRow a={unitRun.review} now={now} />}</ol>}
              </div>
              <p className="font-mono text-[11px] text-zinc-600">
                {unit.contract && <>contracts/{unit.contract} · </>}
                {unit.launchedAt && <>launched {ago(Date.parse(unit.launchedAt), now)} ago</>}
              </p>
            </div>
          )}
          {run && !unit && (
            <div className="space-y-5 p-5">
              <SheetHeader className="p-0">
                <span className={cn("w-fit rounded-md px-2 py-0.5 text-xs", SEG[run.integration].cls)}>integration: {SEG[run.integration].label}</span>
                <SheetTitle className="font-mono text-base">{run.runId}</SheetTitle>
                <SheetDescription>{run.name || "workflow run"} · {run.state} · started {ago(run.startedAt, now)} ago{run.tokens ? ` · ${Math.round(run.tokens / 1000)}k tokens` : ""}</SheetDescription>
              </SheetHeader>
              <div>
                <h4 className="mb-1 text-xs font-medium text-zinc-400">Units in this run</h4>
                {run.unitKeys.map((k) => byKey[k] && <UnitLink key={k} u={byKey[k]} onSelect={onSelect} />)}
              </div>
              {(run.suite || run.review) && (
                <ol className="space-y-1.5">
                  {run.suite && <AgentRow a={run.suite} now={now} />}
                  {run.review && <AgentRow a={run.review} now={now} />}
                </ol>
              )}
              {run.logs.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-medium text-zinc-400">Log</h4>
                  <pre className="whitespace-pre-wrap rounded-md bg-black/40 p-3 font-mono text-[11px] leading-5 text-zinc-400">{run.logs.join("\n")}</pre>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
