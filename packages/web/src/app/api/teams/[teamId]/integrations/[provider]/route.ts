import { NextRequest, NextResponse } from "next/server"

import { snapshotIntegrationIdentifier } from "@/lib/integrations/contract"
import {
  IntegrationAuthorizationAttemptError,
} from "@/lib/integrations/provisioning-store"
import { snapshotSocialProviderName, socialProviderDisplayName } from "@/lib/integrations/social/contract"
import { disconnectSocialConnection } from "@/lib/integrations/social/server"
import { authorizeTeam } from "@/lib/teams/authorization"

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; provider: string }> },
) {
  const { teamId, provider: providerInput } = await context.params
  let provider: ReturnType<typeof snapshotSocialProviderName>
  try {
    provider = snapshotSocialProviderName(providerInput)
  } catch {
    return response(404, "Social integration not found")
  }
  const authorization = await authorizeTeam(teamId, true, request.signal)
  if (authorization.error) return authorization.error
  try {
    const result = await disconnectSocialConnection(
      provider,
      snapshotIntegrationIdentifier(teamId),
      snapshotIntegrationIdentifier(authorization.user.id),
    )
    return NextResponse.json(
      {
        disconnected: result.connection?.status === "disconnected",
        providerAccessRemoved: result.providerAccessRemoved,
      },
      { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
    )
  } catch (error) {
    if (error instanceof IntegrationAuthorizationAttemptError && error.reason === "forbidden") {
      return response(403, "Forbidden")
    }
    return response(502, `Unable to disconnect ${socialProviderDisplayName(provider)}`)
  }
}

function response(status: number, error: string) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    },
  )
}
