import { NextRequest, NextResponse } from "next/server"
import { drainPendingFormEventDeliveries } from "@/lib/forms/form-event-deliveries"
import { createFormPersistence } from "@/lib/forms/routing-persistence"

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Form event worker is not configured" }, { status: 503 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const processed = await drainPendingFormEventDeliveries(
      createFormPersistence(),
      100,
      undefined,
      Date.now() + 40_000,
    )
    return NextResponse.json({ processed })
  } catch {
    return NextResponse.json({ error: "Could not process form event deliveries" }, { status: 500 })
  }
}
