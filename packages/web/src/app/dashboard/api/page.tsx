import { ApiSettings } from "../ApiSettings";
import { getDashboardSession } from "@/lib/dashboard/server";
import { canManage } from "@/lib/teams/server";

export default async function ApiPage() {
  const { activeTeam } = await getDashboardSession();

  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-900">Public API</h1>
      <p className="mt-1 text-gray-500">
        Integrate with {activeTeam.name} through the Screeem REST API.
      </p>
      <ApiSettings teamId={activeTeam.id} canManage={canManage(activeTeam.role)} />
    </>
  );
}
