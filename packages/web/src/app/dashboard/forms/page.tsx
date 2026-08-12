import { Forms } from "../Forms"
import { getDashboardSession } from "@/lib/dashboard/server"
import { canManage } from "@/lib/teams/server"

export default async function FormsPage() {
  const { activeTeam } = await getDashboardSession()

  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-900">Forms</h1>
      <p className="mt-1 text-gray-500">
        Create endpoints and review submissions for {activeTeam.name}.
      </p>
      <Forms teamId={activeTeam.id} canManage={canManage(activeTeam.role)} />
    </>
  )
}
