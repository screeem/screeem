import { NextRequest, NextResponse } from "next/server"
import {
  snapshotIntegrationConnection,
  snapshotIntegrationIdentifier,
  snapshotIntegrationListResponse,
  snapshotIntegrationTeamControl,
} from "@/lib/integrations/contract"
import {
  createIntegrationConnectionStore,
  createIntegrationCredentialStore,
  createIntegrationTeamControlStore,
  productionIntegrationProviderRegistry,
} from "@/lib/integrations/server"
import { authorizeTeam } from "@/lib/teams/authorization"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await context.params
  const authorization = await authorizeTeam(teamId)
  if (authorization.error) return authorization.error

  try {
    const safeTeamId = snapshotIntegrationIdentifier(teamId)
    const connections = (await createIntegrationConnectionStore().list(safeTeamId)).map(
      snapshotIntegrationConnection,
    )
    if (connections.some((connection) => connection.teamId !== safeTeamId)) {
      throw new TypeError("Integration scope mismatch")
    }
    const control = snapshotIntegrationTeamControl(
      await createIntegrationTeamControlStore().get(safeTeamId),
    )
    if (control.teamId !== safeTeamId) throw new TypeError("Integration scope mismatch")
    const credentialIds = await createIntegrationCredentialStore().listPresentConnectionIds(
      safeTeamId,
      connections.map((connection) => connection.id),
    )
    const response = snapshotIntegrationListResponse({
      integrations: connections.map((connection) =>
        productionIntegrationProviderRegistry.summarize(
          connection,
          control,
          credentialIds.has(connection.id),
        ),
      ),
    })
    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Unable to load integrations" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
