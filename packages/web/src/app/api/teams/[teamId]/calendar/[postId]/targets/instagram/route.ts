import { NextRequest, NextResponse } from "next/server"
import { Effect, Either } from "effect"

import { readIntegrationJson } from "@/lib/integrations/api"
import {
  InstagramSchedulingAuthorizationError,
  InstagramSchedulingPersistenceError,
  InstagramSchedulingRequestError,
  InstagramSchedulingStateError,
  PostgresInstagramSchedulingStore,
} from "@/lib/integrations/social/instagram-scheduling"
import { authorizeTeam } from "@/lib/teams/authorization"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; postId: string }> },
) {
  const { teamId, postId } = await context.params
  const authorization = await authorizeTeam(teamId, false, request.signal)
  if (authorization.error) return authorization.error

  const body = await readIntegrationJson(request, 4_096, request.signal)
  if ("response" in body) return body.response
  const parsed = createRequestBody(body.value)
  if (parsed === null) return response(400, "Invalid request body")

  const result = await Effect.runPromise(Effect.either(
    new PostgresInstagramSchedulingStore().createApprovedTarget({
      teamId,
      calendarPostId: postId,
      expectedCalendarRevision: parsed.expectedCalendarRevision,
      requestId: parsed.requestId,
      actorId: authorization.user.id,
    }),
  ))
  if (Either.isRight(result)) {
    return NextResponse.json(result.right, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    })
  }
  return schedulingError(result.left)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; postId: string }> },
) {
  const { teamId, postId } = await context.params
  const authorization = await authorizeTeam(teamId, false, request.signal)
  if (authorization.error) return authorization.error

  const body = await readIntegrationJson(request, 4_096, request.signal)
  if ("response" in body) return body.response
  const parsed = cancelRequestBody(body.value)
  if (parsed === null) return response(400, "Invalid request body")

  const result = await Effect.runPromise(Effect.either(
    new PostgresInstagramSchedulingStore().cancelScheduledTarget({
      teamId,
      calendarPostId: postId,
      targetId: parsed.targetId,
      expectedCalendarRevision: parsed.expectedCalendarRevision,
      requestId: parsed.requestId,
      actorId: authorization.user.id,
    }),
  ))
  if (Either.isRight(result)) {
    return NextResponse.json(result.right, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    })
  }
  return schedulingError(result.left)
}

function createRequestBody(input: unknown): {
  readonly expectedCalendarRevision: number
  readonly requestId: string
} | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) =>
    key !== "expectedCalendarRevision" && key !== "requestId"
  )) return null
  if (typeof value.requestId !== "string"
    || typeof value.expectedCalendarRevision !== "number") return null
  return {
    requestId: value.requestId,
    expectedCalendarRevision: value.expectedCalendarRevision,
  }
}

function cancelRequestBody(input: unknown): {
  readonly expectedCalendarRevision: number
  readonly requestId: string
  readonly targetId: string
} | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) =>
    key !== "expectedCalendarRevision" && key !== "requestId" && key !== "targetId"
  )) return null
  if (typeof value.requestId !== "string"
    || typeof value.targetId !== "string"
    || typeof value.expectedCalendarRevision !== "number") return null
  return {
    requestId: value.requestId,
    targetId: value.targetId,
    expectedCalendarRevision: value.expectedCalendarRevision,
  }
}

function schedulingError(
  error:
    | InstagramSchedulingAuthorizationError
    | InstagramSchedulingPersistenceError
    | InstagramSchedulingRequestError
    | InstagramSchedulingStateError,
) {
  if (error instanceof InstagramSchedulingRequestError) {
    return response(400, "Invalid scheduling request")
  }
  if (error instanceof InstagramSchedulingAuthorizationError) {
    return response(403, "Forbidden")
  }
  if (error instanceof InstagramSchedulingStateError) {
    if (error.reason === "calendar_missing") return response(404, "Calendar post not found")
    if (error.reason === "target_missing") return response(404, "Instagram target not found")
    if (error.reason === "revision_conflict") {
      return response(409, "The calendar post changed. Refresh before scheduling.")
    }
    if (error.reason === "not_approved") {
      return response(409, "Approve the current revision before scheduling.")
    }
    if (error.reason === "target_not_configured") {
      return response(409, "Configure Instagram for the current post before scheduling.")
    }
    if (error.reason === "asset_unavailable") {
      return response(409, "One or more Instagram media files are not ready.")
    }
    if (error.reason === "connection_unavailable") {
      return response(409, "Connect Instagram before scheduling.")
    }
    if (error.reason === "integration_disabled") {
      return response(409, "Team integrations are disabled.")
    }
    if (error.reason === "delivery_active") {
      return response(409, "Instagram publishing has already started.")
    }
    if (error.reason === "target_inactive") {
      return response(409, "The Instagram target is no longer scheduled.")
    }
    return response(409, "The scheduling request conflicts with an existing target.")
  }
  return response(500, "Unable to schedule the Instagram target")
}

function response(status: number, error: string) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  )
}
