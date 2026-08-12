import "server-only"

import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"

export type TeamRole = "owner" | "admin" | "member"

export type UserTeam = {
  id: string
  name: string
  role: TeamRole
}

type MembershipRow = { team_id: string; role: string }
type TeamRow = { id: string; name: string }

export const ACTIVE_TEAM_COOKIE = "screeem_team"

export async function getUserTeams(userId: string, email?: string | null): Promise<UserTeam[]> {
  const admin = createAdminClient()
  const { data: rawMemberships, error } = await admin
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId)

  if (error) throw new Error(error.message)
  let memberships = (rawMemberships ?? []) as MembershipRow[]

  // Handles local databases where a user was created between migrations.
  if (!memberships.length) {
    const personalName = `${email?.split("@")[0] || "My"}'s team`
    const { data: team, error: teamError } = await admin
      .from("teams")
      .insert({ name: personalName, created_by: userId })
      .select("id")
      .single()
    if (teamError || !team) throw new Error(teamError?.message ?? "Could not create team")
    const { error: memberError } = await admin
      .from("team_members")
      .insert({ team_id: team.id, user_id: userId, role: "owner" })
    if (memberError) throw new Error(memberError.message)
    memberships = [{ team_id: team.id, role: "owner" }]
  }

  const { data: teams, error: teamsError } = await admin
    .from("teams")
    .select("id, name")
    .in(
      "id",
      memberships.map((membership) => membership.team_id),
    )
  if (teamsError) throw new Error(teamsError.message)

  const roles = new Map(
    memberships.map((membership) => [membership.team_id, membership.role as TeamRole]),
  )
  return ((teams ?? []) as TeamRow[])
    .map((team) => ({ ...team, role: roles.get(team.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getActiveTeam(userId: string, email?: string | null) {
  const teams = await getUserTeams(userId, email)
  const cookieStore = await cookies()
  const requestedId = cookieStore.get(ACTIVE_TEAM_COOKIE)?.value
  const activeTeam = teams.find((team) => team.id === requestedId) ?? teams[0]
  return { activeTeam, teams }
}

export async function getMembership(userId: string, teamId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle()
  return data ? { role: data.role as TeamRole } : null
}

export function canManage(role: TeamRole) {
  return role === "owner" || role === "admin"
}
