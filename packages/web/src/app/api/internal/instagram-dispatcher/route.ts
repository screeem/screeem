import { NextRequest, NextResponse } from "next/server"
import {
  drainInstagramDispatchQueue,
  enqueueDueInstagramTargets,
  PostgresInstagramDispatchQueueStore,
  PostgresInstagramDispatchTargetGate,
  unimplementedInstagramPublisher,
} from "@/lib/integrations/social/instagram-dispatcher"

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Instagram dispatcher is not configured" }, { status: 503 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const enqueued = await enqueueDueInstagramTargets(undefined, 50)
    const drained = await drainInstagramDispatchQueue(
      new PostgresInstagramDispatchQueueStore(),
      new PostgresInstagramDispatchTargetGate(),
      unimplementedInstagramPublisher,
      { batchSize: 25, visibilityTimeoutSeconds: 60 },
    )
    return NextResponse.json({ enqueued, drained })
  } catch {
    return NextResponse.json({ error: "Could not drain Instagram dispatch queue" }, { status: 500 })
  }
}
