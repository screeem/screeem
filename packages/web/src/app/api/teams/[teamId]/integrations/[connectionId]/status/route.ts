import { NextRequest, NextResponse } from "next/server"
import {
  snapshotIntegrationConnection,
  snapshotIntegrationIdentifier,
  snapshotIntegrationStatusResponse,
  snapshotIntegrationTeamControl,
} from "@/lib/integrations/contract"
import {
  createIntegrationConnectionStore,
  createIntegrationCredentialStore,
  createIntegrationTeamControlStore,
  productionIntegrationProviderRegistry,
} from "@/lib/integrations/server"
import { IntegrationConnectionNotFoundError } from "@/lib/integrations/stores"
import { authorizeTeam } from "@/lib/teams/authorization"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string; connectionId: string }> },
) {
  const { teamId, connectionId } = await context.params
  const authorization = await authorizeTeam(teamId)
  if (authorization.error) return authorization.error

  let safeTeamId: ReturnType<typeof snapshotIntegrationIdentifier>
  let safeConnectionId: ReturnType<typeof snapshotIntegrationIdentifier>
  try {
    safeTeamId = snapshotIntegrationIdentifier(teamId)
    safeConnectionId = snapshotIntegrationIdentifier(connectionId)
  } catch {
    return NextResponse.json(
      { error: "Invalid integration identifier" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  try {
    const connection = snapshotIntegrationConnection(
      await createIntegrationConnectionStore().get(safeTeamId, safeConnectionId),
    )
    const control = snapshotIntegrationTeamControl(
      await createIntegrationTeamControlStore().get(safeTeamId),
    )
    if (connection.teamId !== safeTeamId || control.teamId !== safeTeamId) {
      throw new TypeError("Integration scope mismatch")
    }
    const present = await createIntegrationCredentialStore().listPresentConnectionIds(
      safeTeamId,
      [safeConnectionId],
    )
    const response = snapshotIntegrationStatusResponse({
      integration: productionIntegrationProviderRegistry.summarize(
        connection,
        control,
        present.has(safeConnectionId),
      ),
    })
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const status = error instanceof IntegrationConnectionNotFoundError ? 404 : 500
    return NextResponse.json(
      { error: status === 404 ? "Integration not found" : "Unable to load integration" },
      { status, headers: { "Cache-Control": "no-store" } },
    )
  }
}
