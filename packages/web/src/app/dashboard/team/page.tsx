import { TeamSettings, type TeamInvitationView, type TeamMemberView } from "../TeamSettings";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardSession } from "@/lib/dashboard/server";
import { canManage } from "@/lib/teams/server";

export default async function TeamPage() {
  const { activeTeam } = await getDashboardSession();
  const admin = createAdminClient();
  const { data: membershipRows } = await admin
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", activeTeam.id)
    .order("joined_at", { ascending: true });

  const members: TeamMemberView[] = await Promise.all(
    ((membershipRows ?? []) as { user_id: string; role: "owner" | "admin" | "member" }[]).map(
      async (membership) => {
        const { data } = await admin.auth.admin.getUserById(membership.user_id);
        return {
          userId: membership.user_id,
          email: data.user?.email ?? "Unknown user",
          role: membership.role,
        };
      }
    )
  );

  let invitations: TeamInvitationView[] = [];
  if (canManage(activeTeam.role)) {
    const { data } = await admin
      .from("team_invitations")
      .select("id, email, role, token, expires_at")
      .eq("team_id", activeTeam.id)
      .gt("expires_at", new Date().toISOString());
    invitations = ((data ?? []) as {
      id: string;
      email: string;
      role: "admin" | "member";
      token: string;
      expires_at: string;
    }[]).map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expires_at,
    }));
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-foreground">Team settings</h1>
      <p className="mt-1 text-muted-foreground">Manage {activeTeam.name}&apos;s name, members, and invitations.</p>
      <TeamSettings team={activeTeam} members={members} invitations={invitations} />
    </>
  );
}
