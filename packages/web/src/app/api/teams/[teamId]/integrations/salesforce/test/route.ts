import { NextRequest, NextResponse } from "next/server"
import { snapshotIntegrationIdentifier } from "@/lib/integrations/contract"
import { createSalesforceConnectionService } from "@/lib/integrations/server"
import { authorizeTeam } from "@/lib/teams/authorization"
import { IntegrationAuthorizationAttemptError } from "@/lib/integrations/provisioning-store"

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await context.params
  const authorization = await authorizeTeam(teamId, true)
  if (authorization.error) return authorization.error
  try {
    const limits = await (await createSalesforceConnectionService()).test(
      snapshotIntegrationIdentifier(teamId),
      snapshotIntegrationIdentifier(authorization.user.id),
    )
    return NextResponse.json(
      { ok: true, limits },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    if (error instanceof IntegrationAuthorizationAttemptError && error.reason === "forbidden") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      )
    }
    return NextResponse.json(
      { error: "Unable to reach Salesforce" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    )
  }
}
