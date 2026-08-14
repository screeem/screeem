import { NextRequest, NextResponse } from "next/server"
import { drainPendingFormRoutingActions } from "@/lib/forms/routing-actions"
import { createFormRoutingPersistence } from "@/lib/forms/routing-persistence"

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Routing action worker is not configured" }, { status: 503 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const store = createFormRoutingPersistence()
    const processed = await drainPendingFormRoutingActions(
      store,
      100,
      undefined,
      Date.now() + 40_000,
    )
    return NextResponse.json({ processed })
  } catch {
    return NextResponse.json({ error: "Could not process routing actions" }, { status: 500 })
  }
}
