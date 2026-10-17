/* eslint-disable @typescript-eslint/no-explicit-any -- parses loosely typed transcript JSON */
import "server-only"
import os from "node:os"
import type { LogEvent } from "./types"
import { agentFile, readJsonl } from "./units"

const HOME = os.homedir()
const MAX_OUT = 6000

const tilde = (s: string) => s.split(HOME).join("~")
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)
// Long output keeps its head and tail, where errors and summaries usually are
const trimOutput = (s: string) => (s.length > MAX_OUT ? s.slice(0, 2500) + `\n\n… ${s.length - 4500} characters hidden …\n\n` + s.slice(-2000) : s)

function summarize(name: string, input: any): { title: string; detail?: string } {
  const i = input || {}
  switch (name) {
    case "Bash":
      return { title: clip(String(i.command || "").split("\n")[0], 220), detail: String(i.command || "").includes("\n") ? i.command : i.description }
    case "Read":
      return { title: tilde(i.file_path || "") + (i.offset ? `:${i.offset}${i.limit ? "-" + (i.offset + i.limit) : ""}` : "") }
    case "Edit":
      return { title: tilde(i.file_path || ""), detail: `- ${clip(i.old_string || "", 1200)}\n+ ${clip(i.new_string || "", 1200)}` }
    case "MultiEdit":
      return { title: `${tilde(i.file_path || "")} (${(i.edits || []).length} edits)` }
    case "Write":
      return { title: tilde(i.file_path || ""), detail: clip(String(i.content || ""), 2000) }
    case "Grep":
      return { title: `${i.pattern} in ${tilde(i.path || ".")}${i.glob ? " (" + i.glob + ")" : ""}` }
    case "Glob":
      return { title: `${i.pattern}${i.path ? " in " + tilde(i.path) : ""}` }
    case "WebFetch":
      return { title: i.url || "" }
    case "TodoWrite":
      return { title: `${(i.todos || []).length} todos`, detail: (i.todos || []).map((t: any) => `[${t.status}] ${t.content}`).join("\n") }
    default:
      return { title: clip(JSON.stringify(i), 200) }
  }
}

function resultText(c: any): string {
  if (typeof c === "string") return c
  if (Array.isArray(c)) return c.map((b) => (b?.type === "text" ? b.text : b?.type === "image" ? "[image]" : "")).join("\n")
  return ""
}

// Turns an agent's transcript into one row per step: its brief, what it said, each tool call with its output, its final report
export function readAgentLog(runId: string, agentId: string): LogEvent[] | null {
  const file = agentFile(runId, agentId)
  const rows = file ? readJsonl(file) : null
  if (!rows) return null
  const events: LogEvent[] = []
  const byToolId = new Map<string, LogEvent>()
  for (const r of rows) {
    const t = r.timestamp ? Date.parse(r.timestamp) : null
    const content = r.message?.content
    if (r.type === "user" && typeof content === "string" && !events.length) {
      const body = content.includes("follows:\n") ? content.split("follows:\n").slice(1).join("follows:\n") : content
      events.push({ i: events.length, t, kind: "prompt", title: "Brief", detail: tilde(body.replace(/^ {2}/gm, "").trim()) })
      continue
    }
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (r.type === "assistant" && b.type === "text" && b.text?.trim()) {
        events.push({ i: events.length, t, kind: "text", title: b.text.trim() })
      } else if (r.type === "assistant" && b.type === "tool_use") {
        const ev: LogEvent = b.name === "StructuredOutput"
          ? { i: events.length, t, kind: "report", tool: "Report", title: "Final report", detail: JSON.stringify(b.input, null, 2) }
          : { i: events.length, t, kind: "tool", tool: b.name, ...summarize(b.name, b.input), pending: true }
        events.push(ev)
        byToolId.set(b.id, ev)
      } else if (r.type === "user" && b.type === "tool_result") {
        const ev = byToolId.get(b.tool_use_id)
        if (!ev) continue
        ev.pending = false
        if (ev.kind === "tool") { ev.output = tilde(trimOutput(resultText(b.content))); ev.error = !!b.is_error }
        if (t && ev.t) ev.ms = t - ev.t
      }
    }
  }
  return events
}
