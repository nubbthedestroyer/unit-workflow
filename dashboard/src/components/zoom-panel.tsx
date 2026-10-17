"use client"

import { Panel, useReactFlow, useViewport } from "@xyflow/react"
import { Maximize, Minus, Plus } from "lucide-react"

const btn = "grid size-8 place-items-center text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"

// Zoom controls in the top-left corner; the fit button uses the same pane-fitting zoom as page load
export function ZoomPanel({ onFit }: { onFit: () => void }) {
  const rf = useReactFlow()
  const { zoom } = useViewport()
  return (
    <Panel position="top-left" className="!m-3">
      <div className="flex items-center divide-x divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/90 shadow-xl backdrop-blur">
        <button className={btn} onClick={() => rf.zoomOut({ duration: 200 })} title="Zoom out" aria-label="Zoom out">
          <Minus className="size-4" />
        </button>
        <button
          className="h-8 w-14 font-mono text-xs tabular-nums text-zinc-400 hover:bg-white/10 hover:text-white"
          onClick={() => rf.zoomTo(1, { duration: 200 })}
          title="Reset to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className={btn} onClick={() => rf.zoomIn({ duration: 200 })} title="Zoom in" aria-label="Zoom in">
          <Plus className="size-4" />
        </button>
        <button className={btn} onClick={onFit} title="Fit to window" aria-label="Fit to window">
          <Maximize className="size-3.5" />
        </button>
      </div>
    </Panel>
  )
}
