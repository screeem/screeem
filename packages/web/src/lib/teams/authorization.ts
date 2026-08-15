import "server-only"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { canManage, getMembership } from "@/lib/teams/server"

export async function authorizeTeam(
  teamId: string,
  requireManager = false,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const supabase = await abortable(createClient(), signal)
  const {
    data: { user },
  } = await abortable(supabase.auth.getUser(), signal)
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const membership = await getMembership(user.id, teamId, signal)
  if (!membership || (requireManager && !canManage(membership.role))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { user, membership }
}

async function abortable<Value>(promise: PromiseLike<Value>, signal?: AbortSignal): Promise<Value> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<Value>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}
