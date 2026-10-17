import { NextResponse } from "next/server"
import { getState } from "@/lib/units"

export const dynamic = "force-dynamic"

export function GET(req: Request) {
  const plan = new URL(req.url).searchParams.get("plan")
  return NextResponse.json(getState(plan))
}
