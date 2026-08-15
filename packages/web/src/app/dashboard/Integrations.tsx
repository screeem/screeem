"use client"

import {
  snapshotIntegrationListResponse,
  type IntegrationConnectionSummary,
} from "../../lib/integrations/contract"
import { useCallback, useEffect, useRef, useState } from "react"

type OAuthResult = "connected" | "error" | null
type Operation = "connect" | "reconnect" | "test" | "disconnect"

export function Integrations({
  teamId,
  canManage,
  oauthResult,
  fetcher = fetch,
  navigate = (url) => window.location.assign(url),
  confirmDisconnect = (message) => window.confirm(message),
}: {
  readonly teamId: string
  readonly canManage: boolean
  readonly oauthResult: OAuthResult
  readonly fetcher?: typeof fetch
  readonly navigate?: (url: string) => void
  readonly confirmDisconnect?: (message: string) => boolean
}) {
  return (
    <IntegrationsForTeam
      key={teamId}
      teamId={teamId}
      canManage={canManage}
      oauthResult={oauthResult}
      fetcher={fetcher}
      navigate={navigate}
      confirmDisconnect={confirmDisconnect}
    />
  )
}

function IntegrationsForTeam({
  teamId,
  canManage,
  oauthResult,
  fetcher,
  navigate,
  confirmDisconnect,
}: {
  readonly teamId: string
  readonly canManage: boolean
  readonly oauthResult: OAuthResult
  readonly fetcher: typeof fetch
  readonly navigate: (url: string) => void
  readonly confirmDisconnect: (message: string) => boolean
}) {
  const request = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const [integrations, setIntegrations] = useState<readonly IntegrationConnectionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [message, setMessage] = useState(
    oauthResult === "connected"
      ? "Salesforce authorization completed. This team’s connection status is shown below."
      : oauthResult === "error"
        ? "Salesforce authorization was not completed."
        : "",
  )
  const [error, setError] = useState("")

  const loadIntegrations = useCallback(async () => {
    const currentRequest = ++request.current
    controller.current?.abort()
    const currentController = new AbortController()
    controller.current = currentController
    setLoading(true)
    setIntegrations([])
    setError("")
    try {
      const response = await fetcher(`/api/teams/${encodeURIComponent(teamId)}/integrations`, {
        signal: currentController.signal,
        cache: "no-store",
      })
      const body = await readBoundedJson(response)
      if (currentRequest !== request.current) return
      if (!response.ok) throw new Error("Could not load integrations.")
      setIntegrations(snapshotIntegrationListResponse(body).integrations)
    } catch {
      if (currentRequest !== request.current || currentController.signal.aborted) return
      setError("Could not load integrations.")
    } finally {
      if (currentRequest === request.current) setLoading(false)
      if (controller.current === currentController) controller.current = null
    }
  }, [fetcher, teamId])

  useEffect(() => {
    void loadIntegrations()
    return () => {
      request.current += 1
      controller.current?.abort()
    }
  }, [loadIntegrations])

  async function startOAuth(kind: "connect" | "reconnect") {
    const { requestId, abort } = beginOperation(kind)
    try {
      const response = await fetcher(
        `/api/teams/${encodeURIComponent(teamId)}/integrations/salesforce/${kind}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ returnPath: "/dashboard/integrations" }),
          signal: abort.signal,
        },
      )
      const body = await readBoundedJson(response)
      if (requestId !== request.current) return
      if (!response.ok) throw new Error("Could not start Salesforce authorization.")
      navigate(authorizationUrl(body))
    } catch {
      finishWithError(requestId, abort, "Could not start Salesforce authorization.")
    }
  }

  async function testConnection() {
    const { requestId, abort } = beginOperation("test")
    try {
      const response = await fetcher(
        `/api/teams/${encodeURIComponent(teamId)}/integrations/salesforce/test`,
        { method: "POST", signal: abort.signal },
      )
      await readBoundedJson(response)
      if (requestId !== request.current) return
      if (!response.ok) throw new Error("Salesforce could not be reached. Reconnect and try again.")
      setMessage("Salesforce connection is healthy.")
      setOperation(null)
      await loadIntegrations()
    } catch {
      finishWithError(requestId, abort, "Salesforce connection test failed.")
    }
  }

  async function disconnect() {
    if (!confirmDisconnect("Disconnect Salesforce from this team?")) return
    const { requestId, abort } = beginOperation("disconnect")
    try {
      const response = await fetcher(
        `/api/teams/${encodeURIComponent(teamId)}/integrations/salesforce`,
        { method: "DELETE", signal: abort.signal },
      )
      await readBoundedJson(response)
      if (requestId !== request.current) return
      if (!response.ok) throw new Error("Could not disconnect Salesforce.")
      setMessage("Salesforce was disconnected.")
      setOperation(null)
      await loadIntegrations()
    } catch {
      finishWithError(requestId, abort, "Could not disconnect Salesforce.")
    }
  }

  function beginOperation(next: Operation) {
    const requestId = ++request.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setOperation(next)
    setError("")
    setMessage("")
    return { requestId, abort }
  }

  function finishWithError(
    requestId: number,
    abort: AbortController,
    fallback: string,
  ) {
    if (requestId !== request.current || abort.signal.aborted) return
    setError(fallback)
    setOperation(null)
    if (controller.current === abort) controller.current = null
  }

  const salesforce = integrations.find((integration) => integration.provider === "salesforce")

  return (
    <section className="mt-7" aria-busy={loading || operation !== null}>
      {message ? (
        <p role="status" className="mb-4 border-l-2 border-teal-600 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">CRM</p>
            <h2 className="mt-2 text-lg font-semibold text-gray-950">Salesforce</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-gray-600">
              Validate the connection, then preview mapped CRM actions while building forms.
            </p>
          </div>
          <StatusBadge integration={salesforce} loading={loading} />
        </div>

        {salesforce ? (
          <>
            <dl className="mt-6 grid gap-4 border-t border-gray-100 pt-5 text-sm sm:grid-cols-2">
              <Detail label="Organization" value={salesforce.displayName ?? "Connected organization"} />
              <Detail label="Organization ID" value={salesforce.externalAccountId ?? "Unavailable"} />
              <Detail label="Connection" value={connectionLabel(salesforce)} />
              <Detail label="Last checked" value={formatTimestamp(salesforce.lastCheckedAt)} />
            </dl>
            {connectionNotice(salesforce) ? (
              <p className="mt-5 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {connectionNotice(salesforce)}
              </p>
            ) : null}
          </>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3 border-t border-gray-100 pt-5">
          {!canManage ? (
            <p className="text-sm text-gray-500">Only team owners and admins can manage integrations.</p>
          ) : !salesforce ? (
            <button
              type="button"
              disabled={operation !== null || loading}
              onClick={() => void startOAuth("connect")}
              className={primaryButton}
            >
              {operation === "connect" ? "Connecting…" : "Connect Salesforce"}
            </button>
          ) : (
            <>
              {salesforce.availability === "available" ? (
                <button
                  type="button"
                  disabled={operation !== null || loading}
                  onClick={() => void testConnection()}
                  className={primaryButton}
                >
                  {operation === "test" ? "Testing…" : "Test connection"}
                </button>
              ) : null}
              {canReconnect(salesforce) ? (
                <button
                  type="button"
                  disabled={operation !== null || loading}
                  onClick={() => void startOAuth("reconnect")}
                  className={secondaryButton}
                >
                  {operation === "reconnect" ? "Reconnecting…" : "Reconnect"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={operation !== null || loading}
                onClick={() => void disconnect()}
                className="rounded-md px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {operation === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function StatusBadge({ integration, loading }: {
  readonly integration?: IntegrationConnectionSummary
  readonly loading: boolean
}) {
  const available = integration?.availability === "available"
  const label = loading
    ? "Loading"
    : !integration || integration.status === "disconnected"
      ? "Not connected"
      : integration.status === "reauthorization_required"
        ? "Reconnect required"
        : available
          ? "Connected"
          : "Unavailable"
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
      available ? "bg-teal-50 text-teal-700" : "bg-gray-100 text-gray-600"
    }`}>
      {label}
    </span>
  )
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-1 break-words font-medium text-gray-800">{value}</dd>
    </div>
  )
}

function connectionLabel(integration: IntegrationConnectionSummary) {
  if (integration.status === "reauthorization_required") return "Reauthorization required"
  if (integration.availability === "global_disabled") return "Disabled for this deployment"
  if (integration.availability === "team_disabled") return "Disabled for this team"
  if (integration.availability === "connection_disabled") return "Connection disabled"
  if (integration.availability === "credentials_unavailable") return "Credentials unavailable"
  if (integration.health === "degraded") return "Degraded"
  return integration.status === "connected" ? "Connected" : "Disconnected"
}

function connectionNotice(integration: IntegrationConnectionSummary) {
  if (integration.status === "reauthorization_required") {
    return "Salesforce authorization expired. Reconnect to continue."
  }
  if (integration.lastErrorCode === "rate_limited") {
    return "Salesforce is rate limited. Try again later."
  }
  if (integration.lastErrorCode === "authorization_failed") {
    return "Salesforce denied this operation. Reconnect or review the connected app permissions."
  }
  if (integration.lastErrorCode === "provider_unavailable") {
    return "Salesforce is temporarily unavailable. Try again later."
  }
  if (integration.lastErrorCode === "invalid_configuration") {
    return "Salesforce needs configuration before it can be used."
  }
  return null
}

function canReconnect(integration: IntegrationConnectionSummary) {
  return integration.availability === "available" ||
    integration.status === "disconnected" ||
    integration.status === "reauthorization_required" ||
    integration.availability === "connection_unavailable" ||
    integration.availability === "credentials_unavailable"
}

function formatTimestamp(input: string | null) {
  if (!input) return "Not tested"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(input),
  )
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const maximumBytes = 32_768
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error("The integrations response was invalid.")
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown
  } catch {
    throw new Error("The integrations response was invalid.")
  }
}

function authorizationUrl(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid authorization response")
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (Object.getOwnPropertySymbols(input).length > 0 || Object.keys(descriptors).some((key) => key !== "authorizationUrl")) {
    throw new TypeError("Invalid authorization response")
  }
  const descriptor = descriptors.authorizationUrl
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
    throw new TypeError("Invalid authorization response")
  }
  const url = new URL(descriptor.value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["login.salesforce.com", "test.salesforce.com"].includes(url.hostname.toLowerCase()) ||
    url.pathname !== "/services/oauth2/authorize"
  ) {
    throw new TypeError("Invalid authorization response")
  }
  return url.toString()
}

const primaryButton =
  "rounded-md bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
const secondaryButton =
  "rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
