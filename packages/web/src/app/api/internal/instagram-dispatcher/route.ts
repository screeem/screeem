import { NextRequest, NextResponse } from "next/server"
import {
  drainInstagramDispatchQueue,
  enqueueDueInstagramTargets,
  PostgresInstagramDispatchEventWriter,
  PostgresInstagramDispatchQueueStore,
  PostgresInstagramDispatchTargetGate,
  unimplementedInstagramPublisher,
} from "@/lib/integrations/social/instagram-dispatcher"

export const maxDuration = 60

const drainDeadlineMs = 40_000

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Instagram dispatcher is not configured" }, { status: 503 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  let enqueued: number
  try {
    enqueued = await enqueueDueInstagramTargets(undefined, 50)
  } catch (error) {
    console.error("Instagram dispatcher enqueue failed", error)
    return NextResponse.json({ error: "Could not enqueue Instagram dispatch queue", phase: "enqueue" }, { status: 500 })
  }
  try {
    const drained = await drainInstagramDispatchQueue(
      new PostgresInstagramDispatchQueueStore(),
      new PostgresInstagramDispatchTargetGate(),
      unimplementedInstagramPublisher,
      new PostgresInstagramDispatchEventWriter(),
      {
        batchSize: 25,
        visibilityTimeoutSeconds: 60,
        deadlineTimestampMs: Date.now() + drainDeadlineMs,
      },
    )
    return NextResponse.json({ enqueued, drained })
  } catch (error) {
    console.error("Instagram dispatcher drain failed", error)
    return NextResponse.json({ error: "Could not drain Instagram dispatch queue", phase: "drain", enqueued }, { status: 500 })
  }
}
