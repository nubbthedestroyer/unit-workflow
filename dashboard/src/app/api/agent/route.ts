import { NextResponse } from "next/server"
import { readAgentLog } from "@/lib/agent-log"
import { demoAgentLog } from "@/lib/demo"

export const dynamic = "force-dynamic"

export function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const run = q.get("run") || ""
  const agent = q.get("agent") || ""
  const events = run.startsWith("wf_demo-") ? demoAgentLog(agent) : readAgentLog(run, agent)
  if (!events) return NextResponse.json({ error: "transcript not found" }, { status: 404 })
  return NextResponse.json({ events })
}
