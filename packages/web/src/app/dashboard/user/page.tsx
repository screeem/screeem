import { McpSetup } from "../McpSetup";
import { ProfileForm } from "../ProfileForm";
import { getDashboardSession } from "@/lib/dashboard/server";
import { canManage } from "@/lib/teams/server";

export default async function UserPage() {
  const { user, activeTeam } = await getDashboardSession();

  return (
    <>
      <h1 className="text-2xl font-semibold text-foreground">User settings</h1>
      <p className="mt-1 text-muted-foreground">Manage connected accounts and your Screeem integrations.</p>
      <ProfileForm
        userId={user.id}
        teamId={activeTeam.id}
        canManage={canManage(activeTeam.role)}
      />
      <McpSetup teamId={activeTeam.id} />
    </>
  );
}
