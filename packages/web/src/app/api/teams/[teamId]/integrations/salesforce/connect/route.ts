import { NextRequest, NextResponse } from "next/server"
import { readIntegrationJson } from "@/lib/integrations/api"
import { snapshotIntegrationIdentifier } from "@/lib/integrations/contract"
import { createSalesforceConnectionService } from "@/lib/integrations/server"
import { snapshotSalesforceReturnPath } from "@/lib/integrations/salesforce/contract"
import { authorizeTeam } from "@/lib/teams/authorization"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await context.params
  const authorization = await authorizeTeam(teamId, true)
  if (authorization.error) return authorization.error
  const body = await readIntegrationJson(request)
  if ("response" in body) return body.response
  let value: ReturnType<typeof requestBody>
  try {
    value = requestBody(body.value)
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }
  try {
    const result = await (await createSalesforceConnectionService()).begin(
      snapshotIntegrationIdentifier(teamId),
      snapshotIntegrationIdentifier(authorization.user.id),
      value.returnPath,
    )
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json(
      { error: "Unable to start Salesforce connection" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
}

function requestBody(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid request")
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Object.getOwnPropertySymbols(input).length > 0 || Object.keys(descriptors).some((key) => key !== "returnPath")) {
    throw new TypeError("Invalid request")
  }
  const descriptor = descriptors.returnPath
  return { returnPath: snapshotSalesforceReturnPath(descriptor && "value" in descriptor ? descriptor.value : undefined) }
}
