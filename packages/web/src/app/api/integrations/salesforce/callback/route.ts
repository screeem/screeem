import { NextRequest, NextResponse } from "next/server"
import {
  createSalesforceConnectionService,
  createSalesforceReturnUrl,
} from "@/lib/integrations/server"
import { createClient } from "@/lib/supabase/server"
import { canManage, getMembership } from "@/lib/teams/server"
import { snapshotIntegrationIdentifier } from "@/lib/integrations/contract"
import { IntegrationAuthorizationAttemptError } from "@/lib/integrations/provisioning-store"

export async function GET(request: NextRequest) {
  const stateToken = request.nextUrl.searchParams.get("state")
  const code = request.nextUrl.searchParams.get("code")
  const providerError = request.nextUrl.searchParams.get("error")
  const hasCode = validCode(code)
  const hasProviderError = validProviderError(providerError)
  if (
    !validState(stateToken) ||
    (providerError !== null && !hasProviderError) ||
    hasCode === hasProviderError
  ) {
    return errorResponse(400, "Invalid Salesforce callback")
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, "Unauthorized")

  let service: Awaited<ReturnType<typeof createSalesforceConnectionService>>
  try {
    service = await createSalesforceConnectionService()
    const state = await service.consumeState(stateToken, snapshotIntegrationIdentifier(user.id))
    if (!state) return errorResponse(400, "Salesforce connection request expired")
    if (hasProviderError) {
      return redirectResponse(createSalesforceReturnUrl(state.returnPath, "error"))
    }
    if (!validCode(code)) return errorResponse(400, "Invalid Salesforce callback")
    const membership = await getMembership(user.id, state.teamId)
    if (!membership || !canManage(membership.role)) return errorResponse(403, "Forbidden")
    await service.complete(state, code)
    return redirectResponse(createSalesforceReturnUrl(state.returnPath, "connected"))
  } catch (error) {
    if (error instanceof IntegrationAuthorizationAttemptError) {
      return errorResponse(
        error.reason === "forbidden" ? 403 : 409,
        error.reason === "forbidden" ? "Forbidden" : "Salesforce connection request was superseded",
      )
    }
    return errorResponse(502, "Unable to connect Salesforce")
  }
}

function redirectResponse(url: URL) {
  const response = NextResponse.redirect(url, 303)
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}

function validState(input: string | null): input is string {
  return typeof input === "string" && /^[A-Za-z0-9_-]{43}$/.test(input)
}

function validCode(input: string | null): input is string {
  return typeof input === "string" && input.length > 0 && input.length <= 2_048
}

function validProviderError(input: string | null): input is string {
  return typeof input === "string" && /^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(input)
}

function errorResponse(status: number, error: string) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  )
}
