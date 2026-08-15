import { NextRequest, NextResponse } from "next/server"
import { snapshotFormActionTestResult } from "@screeem/forms"
import { readIntegrationJson } from "@/lib/integrations/api"
import { snapshotIntegrationIdentifier } from "@/lib/integrations/contract"
import { IntegrationResolutionError } from "@/lib/integrations/provider-registry"
import { createSalesforceActionPreviewService } from "@/lib/integrations/server"
import { SalesforceError } from "@/lib/integrations/salesforce/contract"
import { authorizeFormTeam } from "@/lib/forms/authorization"
import { createAdminClient } from "@/lib/supabase/admin"

const maximumPreviewRequestBytes = 256 * 1_024
const previewTimeoutMs = 10_000

type Context = { params: Promise<{ teamId: string; formId: string }> }

export async function POST(request: NextRequest, context: Context) {
  const { teamId, formId } = await context.params
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(previewTimeoutMs)])
  let authorization: Awaited<ReturnType<typeof authorizeFormTeam>>
  try {
    authorization = await authorizeFormTeam(teamId, true, signal)
    signal.throwIfAborted()
  } catch (error) {
    return previewError(error)
  }
  if (authorization.error) return authorization.error

  let safeTeamId: ReturnType<typeof snapshotIntegrationIdentifier>
  let safeFormId: ReturnType<typeof snapshotIntegrationIdentifier>
  try {
    safeTeamId = snapshotIntegrationIdentifier(teamId)
    safeFormId = snapshotIntegrationIdentifier(formId)
  } catch {
    return jsonError("Invalid integration preview identifier", 400)
  }

  const admin = createAdminClient()
  let formFound = false
  try {
    const { data: form, error: formError } = await admin
      .from("forms")
      .select("id")
      .eq("team_id", safeTeamId)
      .eq("id", safeFormId)
      .abortSignal(signal)
      .maybeSingle()
    signal.throwIfAborted()
    if (formError) return jsonError("Unable to preview this integration", 500)
    formFound = Boolean(form)
  } catch (error) {
    return previewError(error)
  }
  if (!formFound) return jsonError("Form not found", 404)

  let body: Awaited<ReturnType<typeof readIntegrationJson>>
  try {
    body = await readIntegrationJson(request, maximumPreviewRequestBytes, signal)
  } catch (error) {
    return previewError(error)
  }
  if ("response" in body) return body.response

  try {
    const result = await createSalesforceActionPreviewService().previewLead(
      safeTeamId,
      body.value,
      signal,
    )
    return NextResponse.json(snapshotFormActionTestResult(result), { headers: noStoreHeaders() })
  } catch (error) {
    return previewError(error)
  }
}

function previewError(error: unknown) {
  if (isAbort(error)) return jsonError("Salesforce preview timed out", 408)
  if (error instanceof IntegrationResolutionError) {
    const disconnected = ["connection_unavailable", "credentials_unavailable"].includes(
      error.reason,
    )
    return jsonError(
      disconnected
        ? "Connect or reconnect Salesforce before previewing"
        : "Salesforce is currently unavailable",
      409,
    )
  }
  if (error instanceof SalesforceError) {
    if (error.code === "authentication_failed" || error.code === "authorization_failed") {
      return jsonError("Reconnect Salesforce before previewing", 409)
    }
    if (error.code === "rate_limited") {
      const retrySeconds = Math.max(1, Math.ceil((error.retryAfterMs ?? 1_000) / 1_000))
      return jsonError("Salesforce is rate limited", 429, { "Retry-After": String(retrySeconds) })
    }
    if (error.code === "invalid_configuration") {
      return jsonError("Salesforce preview is not configured", 503)
    }
    return jsonError("Unable to reach Salesforce", 502)
  }
  if (error instanceof TypeError) return jsonError("Invalid preview request", 400)
  return jsonError("Unable to preview this integration", 500)
}

function jsonError(error: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error },
    { status, headers: { ...noStoreHeaders(), ...headers } },
  )
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store" }
}

function isAbort(error: unknown) {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
}
