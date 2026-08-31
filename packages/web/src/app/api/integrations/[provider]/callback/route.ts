import { NextRequest, NextResponse } from "next/server"

import {
  InvalidSocialConfigurationError,
  InvalidSocialRequestError,
} from "@screeem/integrations/social"

import { snapshotIntegrationIdentifier } from "@/lib/integrations/contract"
import {
  IntegrationAuthorizationAttemptError,
  IntegrationDisconnectInProgressError,
  IntegrationExternalAccountConflictError,
} from "@/lib/integrations/provisioning-store"
import { snapshotSocialProviderName, socialProviderDisplayName } from "@/lib/integrations/social/contract"
import { SocialAccountSwitchError } from "@/lib/integrations/social/service"
import { createSocialConnectionService, createSocialReturnUrl } from "@/lib/integrations/social/server"
import { createClient } from "@/lib/supabase/server"
import { canManage, getMembership } from "@/lib/teams/server"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: providerInput } = await context.params
  let provider: ReturnType<typeof snapshotSocialProviderName>
  try {
    provider = snapshotSocialProviderName(providerInput)
  } catch {
    return response(404, "Social integration not found")
  }
  const values = callbackValues(request.nextUrl)
  if (!values) return response(400, `Invalid ${socialProviderDisplayName(provider)} callback`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return response(401, "Unauthorized")

  let consumedReturnPath: string | null = null
  try {
    const service = await createSocialConnectionService(provider)
    const state = await service.consumeState(
      values.state,
      snapshotIntegrationIdentifier(user.id),
    )
    if (!state) return response(400, `${socialProviderDisplayName(provider)} connection request expired`)
    consumedReturnPath = state.returnPath
    if (values.error !== null) {
      return redirectResponse(createSocialReturnUrl(state.returnPath, provider, "error"))
    }
    const membership = await getMembership(user.id, state.teamId, request.signal)
    if (!membership || !canManage(membership.role)) {
      return redirectResponse(createSocialReturnUrl(state.returnPath, provider, "error", "forbidden"))
    }
    await service.complete(state, values.state, values.code)
    return redirectResponse(createSocialReturnUrl(state.returnPath, provider, "connected"))
  } catch (error) {
    if (consumedReturnPath !== null) {
      try {
        return redirectResponse(createSocialReturnUrl(
          consumedReturnPath,
          provider,
          "error",
          callbackFailureReason(error),
        ))
      } catch {
        return response(502, `Unable to connect ${socialProviderDisplayName(provider)}`)
      }
    }
    if (error instanceof IntegrationAuthorizationAttemptError) {
      return response(
        error.reason === "forbidden" ? 403 : 409,
        error.reason === "forbidden"
          ? "Forbidden"
          : `${socialProviderDisplayName(provider)} connection request was superseded`,
      )
    }
    if (error instanceof SocialAccountSwitchError) {
      return response(409, `Disconnect ${socialProviderDisplayName(provider)} before connecting a different account`)
    }
    if (error instanceof IntegrationDisconnectInProgressError) {
      return response(409, `${socialProviderDisplayName(provider)} is being disconnected`)
    }
    if (error instanceof InvalidSocialRequestError) {
      return response(400, `Invalid ${socialProviderDisplayName(provider)} callback`)
    }
    if (error instanceof InvalidSocialConfigurationError) {
      return response(503, `${socialProviderDisplayName(provider)} is not configured`)
    }
    return response(502, `Unable to connect ${socialProviderDisplayName(provider)}`)
  }
}

function callbackFailureReason(
  error: unknown,
): Parameters<typeof createSocialReturnUrl>[3] {
  if (error instanceof SocialAccountSwitchError) return "account_switch"
  if (error instanceof IntegrationExternalAccountConflictError) return "account_in_use"
  if (error instanceof IntegrationDisconnectInProgressError) return "disconnecting"
  if (error instanceof IntegrationAuthorizationAttemptError && error.reason === "forbidden") {
    return "forbidden"
  }
  if (error instanceof InvalidSocialConfigurationError) return "configuration"
  return undefined
}

function callbackValues(url: URL) {
  const states = url.searchParams.getAll("state")
  const codes = url.searchParams.getAll("code")
  const errors = url.searchParams.getAll("error")
  if (states.length !== 1 || codes.length > 1 || errors.length > 1) return null
  const state = states[0]
  const code = codes[0] ?? null
  const error = errors[0] ?? null
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    (code === null) === (error === null) ||
    (code !== null && (code.length === 0 || code.length > 2_048)) ||
    (error !== null && !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(error))
  ) {
    return null
  }
  return { state, code: code ?? "", error }
}

function redirectResponse(url: URL) {
  const response = NextResponse.redirect(url, 303)
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
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
