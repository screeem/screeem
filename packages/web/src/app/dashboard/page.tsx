import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";
import { ProfileForm } from "./ProfileForm";
import { McpSetup } from "./McpSetup";
import { TeamSwitcher } from "./TeamSwitcher";
import { TeamSettings, type TeamMemberView, type TeamInvitationView } from "./TeamSettings";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, getActiveTeam } from "@/lib/teams/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { activeTeam, teams } = await getActiveTeam(user.id, user.email);
  const admin = createAdminClient();
  const { data: membershipRows } = await admin
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", activeTeam.id)
    .order("joined_at", { ascending: true });
  const members: TeamMemberView[] = await Promise.all(
    ((membershipRows ?? []) as { user_id: string; role: "owner" | "admin" | "member" }[]).map(async (membership) => {
      const { data } = await admin.auth.admin.getUserById(membership.user_id);
      return {
        userId: membership.user_id,
        email: data.user?.email ?? "Unknown user",
        role: membership.role,
      } as TeamMemberView;
    })
  );
  let invitations: TeamInvitationView[] = [];
  if (canManage(activeTeam.role)) {
    const { data } = await admin
      .from("team_invitations")
      .select("id, email, role, token, expires_at")
      .eq("team_id", activeTeam.id)
      .gt("expires_at", new Date().toISOString());
    invitations = ((data ?? []) as { id: string; email: string; role: "admin" | "member"; token: string; expires_at: string }[]).map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expires_at,
    }));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-gray-900">Screeem</span>
            <TeamSwitcher teams={teams} activeTeamId={activeTeam.id} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-gray-500">Manage {activeTeam.name}&apos;s shared Screeem workspace.</p>
        <TeamSettings team={activeTeam} members={members} invitations={invitations} />
        <ProfileForm userId={user.id} teamId={activeTeam.id} canManage={canManage(activeTeam.role)} />
        <McpSetup teamId={activeTeam.id} />
      </main>
    </div>
  );
}
