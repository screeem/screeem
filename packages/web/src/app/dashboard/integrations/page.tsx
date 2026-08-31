import {
  Integrations,
  type IntegrationOAuthFailureReason,
  type IntegrationOAuthResult,
} from "../Integrations"
import { getDashboardSession } from "@/lib/dashboard/server"
import { canManage } from "@/lib/teams/server"

export default async function IntegrationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ integration?: string; status?: string; reason?: string }>
}) {
  const { activeTeam } = await getDashboardSession()
  const query = await searchParams
  const result = oauthResult(query.integration, query.status, query.reason)

  return (
    <>
      <h1 className="text-2xl font-semibold text-foreground">Integrations</h1>
      <p className="mt-1 text-muted-foreground">
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

function oauthResult(
  integration?: string,
  status?: string,
  reason?: string,
): IntegrationOAuthResult | null {
  if (
    !["salesforce", "instagram", "tiktok"].includes(integration ?? "") ||
    !["connected", "error"].includes(status ?? "")
  ) {
    return null
  }
  return {
    provider: integration as IntegrationOAuthResult["provider"],
    status: status as IntegrationOAuthResult["status"],
    reason: status === "error" && isFailureReason(reason) ? reason : null,
  }
}

function isFailureReason(input: string | undefined): input is IntegrationOAuthFailureReason {
  return [
    "account_in_use",
    "account_switch",
    "configuration",
    "disconnecting",
    "forbidden",
  ].includes(input ?? "")
}
