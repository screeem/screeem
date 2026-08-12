import "server-only"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { canManage, getMembership } from "@/lib/teams/server"

export async function authorizeFormTeam(teamId: string, requireManager = false) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const membership = await getMembership(user.id, teamId)
  if (!membership || (requireManager && !canManage(membership.role))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { user, membership }
}
