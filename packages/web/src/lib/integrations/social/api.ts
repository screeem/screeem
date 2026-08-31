import "server-only"

import { NextRequest, NextResponse } from "next/server"

import { readIntegrationJson } from "../api"
import { snapshotIntegrationIdentifier } from "../contract"
import {
  snapshotSocialProviderName,
  snapshotSocialReturnPath,
  socialProviderDisplayName,
} from "./contract"
import { createSocialConnectionService } from "./server"
import { authorizeTeam } from "../../teams/authorization"

export async function beginSocialOAuth(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; provider: string }> },
  forceReauthorization: boolean,
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
  const body = await readIntegrationJson(request, 4_096, request.signal)
  if ("response" in body) return body.response
  let returnPath: string
  try {
    returnPath = requestBody(body.value)
  } catch {
    return response(400, "Invalid request body")
  }
  try {
    const service = await createSocialConnectionService(provider)
    const result = await service.begin(
      snapshotIntegrationIdentifier(teamId),
      snapshotIntegrationIdentifier(authorization.user.id),
      returnPath,
      forceReauthorization,
    )
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    })
  } catch {
    const name = socialProviderDisplayName(provider)
    return response(503, `Unable to start ${name} connection`)
  }
}

function requestBody(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid request")
  }
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (
    Object.getOwnPropertySymbols(input).length > 0 ||
    Object.keys(descriptors).some((key) => key !== "returnPath")
  ) {
    throw new TypeError("Invalid request")
  }
  const descriptor = descriptors.returnPath
  return snapshotSocialReturnPath(descriptor && "value" in descriptor ? descriptor.value : undefined)
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
