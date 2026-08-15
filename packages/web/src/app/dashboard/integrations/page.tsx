import { Integrations } from "../Integrations"
import { getDashboardSession } from "@/lib/dashboard/server"
import { canManage } from "@/lib/teams/server"

export default async function IntegrationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ integration?: string; status?: string }>
}) {
  const { activeTeam } = await getDashboardSession()
  const query = await searchParams
  const result =
    query.integration === "salesforce" && query.status === "connected"
      ? "connected"
      : query.integration === "salesforce" && query.status === "error"
        ? "error"
        : null

  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>
      <p className="mt-1 text-gray-500">
        Connect external tools for {activeTeam.name} and verify them before using form actions.
      </p>
      <Integrations
        teamId={activeTeam.id}
        canManage={canManage(activeTeam.role)}
        oauthResult={result}
      />
    </>
  )
}
