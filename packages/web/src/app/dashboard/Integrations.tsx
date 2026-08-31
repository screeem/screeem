"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Notice } from "@/components/ui/notice"
import { SectionCard } from "@/components/ui/section-card"
import { Separator } from "@/components/ui/separator"
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge"
import {
  snapshotIntegrationListResponse,
  type IntegrationConnectionSummary,
} from "../../lib/integrations/contract"

type Provider = "salesforce" | "instagram" | "tiktok"
type OAuthStatus = "connected" | "error"
export type IntegrationOAuthFailureReason =
  | "account_in_use"
  | "account_switch"
  | "configuration"
  | "disconnecting"
  | "forbidden"
type Operation = "connect" | "reconnect" | "test" | "disconnect"

export interface IntegrationOAuthResult {
  readonly provider: Provider
  readonly status: OAuthStatus
  readonly reason?: IntegrationOAuthFailureReason | null
}

const providerDetails: Record<Provider, { readonly name: string; readonly description: string }> = {
  salesforce: {
    name: "Salesforce",
    description: "Validate the connection, then preview mapped CRM actions while building forms.",
  },
  instagram: {
    name: "Instagram",
    description: "Connect the professional account that Screeem should publish scheduled posts to.",
  },
  tiktok: {
    name: "TikTok",
    description: "Connect the creator account that Screeem should publish scheduled posts to.",
  },
}

export function Integrations({
  teamId,
  canManage,
  oauthResult,
  fetcher = fetch,
  navigate = (url) => window.location.assign(url),
}: {
  readonly teamId: string
  readonly canManage: boolean
  readonly oauthResult: IntegrationOAuthResult | null
  readonly fetcher?: typeof fetch
  readonly navigate?: (url: string) => void
}) {
  return (
    <IntegrationsForTeam
      key={teamId}
      teamId={teamId}
      canManage={canManage}
      oauthResult={oauthResult}
      fetcher={fetcher}
      navigate={navigate}
    />
  )
}

function IntegrationsForTeam({
  teamId,
  canManage,
  oauthResult,
  fetcher,
  navigate,
}: {
  readonly teamId: string
  readonly canManage: boolean
  readonly oauthResult: IntegrationOAuthResult | null
  readonly fetcher: typeof fetch
  readonly navigate: (url: string) => void
}) {
  const generation = useRef(0)
  const loadController = useRef<AbortController | null>(null)
  const operationControllers = useRef(new Map<Provider, AbortController>())
  const [integrations, setIntegrations] = useState<readonly IntegrationConnectionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [operations, setOperations] = useState<Partial<Record<Provider, Operation>>>({})
  const [disconnectTarget, setDisconnectTarget] = useState<Provider | null>(null)
  const [message, setMessage] = useState(() => oauthMessage(oauthResult))
  const [messageTone, setMessageTone] = useState<"success" | "warning">(
    oauthResult?.status === "error" ? "warning" : "success",
  )
  const [providerErrors, setProviderErrors] = useState<Partial<Record<Provider, string>>>({})

  useEffect(() => {
    if (!oauthResult) return
    const url = new URL(window.location.href)
    url.searchParams.delete("integration")
    url.searchParams.delete("status")
    url.searchParams.delete("reason")
    window.history.replaceState(window.history.state, "", url)
  }, [oauthResult])

  const loadIntegrations = useCallback(async () => {
    const currentGeneration = ++generation.current
    loadController.current?.abort()
    const controller = new AbortController()
    const signal = boundedSignal(controller.signal)
    loadController.current = controller
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetcher(`/api/teams/${encodeURIComponent(teamId)}/integrations`, {
        signal,
        cache: "no-store",
      })
      const body = await readBoundedJson(response)
      signal.throwIfAborted()
      if (currentGeneration !== generation.current) return
      if (!response.ok) throw new Error("Could not load integrations.")
      setIntegrations(snapshotIntegrationListResponse(body).integrations)
    } catch {
      if (currentGeneration !== generation.current || controller.signal.aborted) return
      setIntegrations([])
      setLoadFailed(true)
    } finally {
      if (currentGeneration === generation.current) setLoading(false)
      if (loadController.current === controller) loadController.current = null
    }
  }, [fetcher, teamId])

  useEffect(() => {
    void loadIntegrations()
    const controllers = operationControllers.current
    return () => {
      generation.current += 1
      loadController.current?.abort()
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [loadIntegrations])

  async function startOAuth(provider: Provider, kind: "connect" | "reconnect") {
    const controller = beginOperation(provider, kind)
    const signal = boundedSignal(controller.signal)
    try {
      const response = await fetcher(
        `/api/teams/${encodeURIComponent(teamId)}/integrations/${provider}/${kind}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ returnPath: "/dashboard/integrations" }),
          signal,
        },
      )
      const body = await readBoundedJson(response)
      signal.throwIfAborted()
      if (!response.ok) throw new Error("Authorization could not be started.")
      navigate(authorizationUrl(provider, body))
      finishOperation(provider, controller)
    } catch {
      finishWithError(provider, controller, `Could not start ${providerDetails[provider].name} authorization.`)
    }
  }

  async function testSalesforce() {
    const controller = beginOperation("salesforce", "test")
    const signal = boundedSignal(controller.signal)
    try {
      const response = await fetcher(
        `/api/teams/${encodeURIComponent(teamId)}/integrations/salesforce/test`,
        { method: "POST", signal },
      )
      await readBoundedJson(response)
      signal.throwIfAborted()
      if (!response.ok) throw new Error("Salesforce could not be reached.")
      setMessageTone("success")
      setMessage("Salesforce connection is healthy.")
      finishOperation("salesforce", controller)
      await loadIntegrations()
    } catch {
      finishWithError("salesforce", controller, "Salesforce connection test failed.")
    }
  }

  async function disconnect(provider: Provider) {
    setDisconnectTarget(null)
    const controller = beginOperation(provider, "disconnect")
    const signal = boundedSignal(controller.signal)
    try {
      const response = await fetcher(
        `/api/teams/${encodeURIComponent(teamId)}/integrations/${provider}`,
        { method: "DELETE", signal },
      )
      const body = await readBoundedJson(response)
      signal.throwIfAborted()
      if (!response.ok) throw new Error("Disconnect failed.")
      const localOnly = provider !== "salesforce" && providerAccessRemovalIncomplete(body)
      setMessageTone(localOnly ? "warning" : "success")
      setMessage(localOnly
        ? `${providerDetails[provider].name} was disconnected from Screeem. Remove Screeem from the account’s app permissions to finish provider cleanup.`
        : `${providerDetails[provider].name} was disconnected.`)
      finishOperation(provider, controller)
      await loadIntegrations()
    } catch {
      if (controller.signal.aborted) return
      finishWithError(provider, controller, `Could not disconnect ${providerDetails[provider].name}. Try again.`)
      await loadIntegrations()
    }
  }

  function beginOperation(provider: Provider, operation: Operation) {
    operationControllers.current.get(provider)?.abort()
    const controller = new AbortController()
    operationControllers.current.set(provider, controller)
    setOperations((current) => ({ ...current, [provider]: operation }))
    setProviderErrors((current) => ({ ...current, [provider]: undefined }))
    setMessage("")
    return controller
  }

  function finishOperation(provider: Provider, controller: AbortController) {
    if (controller.signal.aborted || operationControllers.current.get(provider) !== controller) return
    operationControllers.current.delete(provider)
    setOperations((current) => {
      const next = { ...current }
      delete next[provider]
      return next
    })
  }

  function finishWithError(provider: Provider, controller: AbortController, fallback: string) {
    if (controller.signal.aborted || operationControllers.current.get(provider) !== controller) return
    setProviderErrors((current) => ({ ...current, [provider]: fallback }))
    finishOperation(provider, controller)
  }

  const byProvider = (provider: Provider) => {
    const connection = integrations.find((integration) => integration.provider === provider)
    return connection?.status === "disconnected" ? undefined : connection
  }

  return (
    <section className="mt-7" aria-busy={loading || Object.keys(operations).length > 0}>
      {message ? <Notice tone={messageTone} className="mb-4">{message}</Notice> : null}
      {loadFailed ? (
        <Notice tone="error" className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not load integrations. Connection controls are unavailable.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadIntegrations()}>
              Retry
            </Button>
          </div>
        </Notice>
      ) : null}

      <SectionCard
        title="Social publishing"
        description="Connect the accounts this team will use for scheduled social posts."
      >
        <ProviderRow
          provider="instagram"
          integration={byProvider("instagram")}
          canManage={canManage}
          controlsAvailable={!loadFailed}
          statusUnavailable={loadFailed}
          loading={loading}
          operation={operations.instagram}
          error={providerErrors.instagram}
          onOAuth={startOAuth}
          onDisconnect={setDisconnectTarget}
        />
        <Separator className="my-5" />
        <ProviderRow
          provider="tiktok"
          integration={byProvider("tiktok")}
          canManage={canManage}
          controlsAvailable={!loadFailed}
          statusUnavailable={loadFailed}
          loading={loading}
          operation={operations.tiktok}
          error={providerErrors.tiktok}
          onOAuth={startOAuth}
          onDisconnect={setDisconnectTarget}
        />
      </SectionCard>

      <SectionCard title="CRM" className="mt-5">
        <ProviderRow
          provider="salesforce"
          integration={byProvider("salesforce")}
          canManage={canManage}
          controlsAvailable={!loadFailed}
          statusUnavailable={loadFailed}
          loading={loading}
          operation={operations.salesforce}
          error={providerErrors.salesforce}
          onOAuth={startOAuth}
          onDisconnect={setDisconnectTarget}
          onTest={testSalesforce}
        />
      </SectionCard>

      <AlertDialog open={disconnectTarget !== null} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {disconnectTarget ? providerDetails[disconnectTarget].name : "integration"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {disconnectTarget === "salesforce"
                ? "Screeem will stop sending CRM form actions through this connection. This does not delete your Salesforce account or sign you out of Salesforce."
                : "Screeem will stop publishing scheduled posts through this connection. This does not delete the account or sign you out of the provider itself."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => disconnectTarget && void disconnect(disconnectTarget)}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function ProviderRow({
  provider,
  integration,
  canManage,
  controlsAvailable,
  statusUnavailable,
  loading,
  operation,
  error,
  onOAuth,
  onDisconnect,
  onTest,
}: {
  readonly provider: Provider
  readonly integration?: IntegrationConnectionSummary
  readonly canManage: boolean
  readonly controlsAvailable: boolean
  readonly statusUnavailable: boolean
  readonly loading: boolean
  readonly operation?: Operation
  readonly error?: string
  readonly onOAuth: (provider: Provider, kind: "connect" | "reconnect") => Promise<void>
  readonly onDisconnect: (provider: Provider) => void
  readonly onTest?: () => Promise<void>
}) {
  const details = providerDetails[provider]
  const busy = operation !== undefined
  const disconnecting = integration?.status === "disconnecting"
  const warning = connectionNotice(provider, integration)
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground">{details.name}</h3>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{details.description}</p>
          {integration ? (
            <p className="mt-2 text-sm font-medium text-foreground">
              {integration.displayName ?? "Connected account"}
              {integration.externalAccountId ? (
                <span className="ml-2 font-normal text-muted-foreground">{integration.externalAccountId}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <IntegrationStatus
          integration={integration}
          loading={loading}
          unavailable={statusUnavailable}
        />
      </div>

      {integration && provider === "salesforce" ? (
        <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
          <Detail label="Organization" value={integration.displayName ?? "Connected organization"} />
          <Detail label="Organization ID" value={integration.externalAccountId ?? "Unavailable"} />
          <Detail label="Connection" value={connectionLabel(integration)} />
          <Detail label="Last checked" value={formatTimestamp(integration.lastCheckedAt)} />
        </dl>
      ) : null}

      {disconnecting ? (
        <Notice tone="warning" className="mt-4">
          Provider revocation did not finish. Publishing is disabled; retry disconnect to finish.
        </Notice>
      ) : warning ? (
        <Notice tone="warning" className="mt-4">{warning}</Notice>
      ) : null}
      {error ? <Notice tone="error" className="mt-4">{error}</Notice> : null}

      <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-5">
        {!canManage ? (
          <p className="text-sm text-muted-foreground">Only team owners and admins can manage integrations.</p>
        ) : !controlsAvailable ? null : !integration ? (
          <Button type="button" disabled={busy || loading} onClick={() => void onOAuth(provider, "connect")}>
            {operation === "connect" ? "Connecting…" : `Connect ${details.name}`}
          </Button>
        ) : (
          <>
            {provider === "salesforce" && integration.availability === "available" && onTest ? (
              <Button type="button" disabled={busy || loading} onClick={() => void onTest()}>
                {operation === "test" ? "Testing…" : "Test connection"}
              </Button>
            ) : null}
            {!disconnecting && canReconnect(integration) ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy || loading}
                onClick={() => void onOAuth(provider, "reconnect")}
              >
                {operation === "reconnect" ? "Reconnecting…" : "Reconnect"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive-ghost"
              disabled={busy || loading}
              onClick={() => onDisconnect(provider)}
            >
              {operation === "disconnect" ? "Disconnecting…" : disconnecting ? "Retry disconnect" : "Disconnect"}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function IntegrationStatus({ integration, loading, unavailable }: {
  readonly integration?: IntegrationConnectionSummary
  readonly loading: boolean
  readonly unavailable: boolean
}) {
  const available = integration?.availability === "available"
  const [label, tone]: readonly [string, StatusTone] = loading
    ? ["Loading", "neutral"]
    : unavailable
      ? ["Unavailable", "warning"]
    : !integration
      ? ["Not connected", "neutral"]
      : integration.status === "disconnecting"
        ? ["Disconnecting", "warning"]
        : integration.status === "reauthorization_required"
          ? ["Reconnect required", "warning"]
          : available
            ? ["Connected", "success"]
            : ["Unavailable", "warning"]
  return <StatusBadge tone={tone} className="px-3 py-1 font-semibold">{label}</StatusBadge>
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium text-foreground">{value}</dd>
    </div>
  )
}

function connectionLabel(integration: IntegrationConnectionSummary) {
  if (integration.status === "disconnecting") return "Disconnecting"
  if (integration.status === "reauthorization_required") return "Reauthorization required"
  if (integration.availability === "global_disabled") return "Disabled for this deployment"
  if (integration.availability === "team_disabled") return "Disabled for this team"
  if (integration.availability === "connection_disabled") return "Connection disabled"
  if (integration.availability === "credentials_unavailable") return "Credentials unavailable"
  if (integration.health === "degraded") return "Degraded"
  return integration.status === "connected" ? "Connected" : "Disconnected"
}

function connectionNotice(provider: Provider, integration?: IntegrationConnectionSummary) {
  if (!integration) return null
  const name = providerDetails[provider].name
  if (integration.status === "reauthorization_required") return `${name} authorization expired. Reconnect to continue.`
  if (integration.lastErrorCode === "rate_limited") return `${name} is rate limited. Try again later.`
  if (integration.lastErrorCode === "authorization_failed") return `${name} denied this operation. Reconnect or review the account permissions.`
  if (integration.lastErrorCode === "provider_unavailable") return `${name} is temporarily unavailable. Try again later.`
  if (integration.lastErrorCode === "invalid_configuration") return `${name} needs configuration before it can be used.`
  return null
}

function canReconnect(integration: IntegrationConnectionSummary) {
  return integration.status !== "disconnecting" && (
    integration.availability === "available" ||
    integration.status === "reauthorization_required" ||
    integration.availability === "connection_unavailable" ||
    integration.availability === "credentials_unavailable"
  )
}

function formatTimestamp(input: string | null) {
  if (!input) return "Not tested"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(input))
}

function oauthMessage(result: IntegrationOAuthResult | null) {
  if (!result) return ""
  const name = providerDetails[result.provider].name
  if (result.status === "connected") {
    return `${name} authorization completed. This team’s connection is shown below.`
  }
  if (result.reason === "account_switch") {
    return `Disconnect the current ${name} account before connecting a different one.`
  }
  if (result.reason === "account_in_use") {
    return `That ${name} account is already connected to another team.`
  }
  if (result.reason === "disconnecting") {
    return `${name} is still being disconnected. Retry disconnect before reconnecting.`
  }
  if (result.reason === "forbidden") {
    return `Only team owners and admins can connect ${name}.`
  }
  if (result.reason === "configuration") {
    return `${name} is not configured for this deployment.`
  }
  return `${name} authorization was not completed.`
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

function authorizationUrl(provider: Provider, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid authorization response")
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (
    Object.getOwnPropertySymbols(input).length > 0 ||
    Object.keys(descriptors).length !== 1 ||
    !("authorizationUrl" in descriptors)
  ) {
    throw new TypeError("Invalid authorization response")
  }
  const descriptor = descriptors.authorizationUrl
  if (!("value" in descriptor) || typeof descriptor.value !== "string") throw new TypeError("Invalid authorization response")
  const url = new URL(descriptor.value)
  const allowed = provider === "salesforce"
    ? ["login.salesforce.com/services/oauth2/authorize", "test.salesforce.com/services/oauth2/authorize"]
    : provider === "instagram"
      ? ["www.instagram.com/oauth/authorize"]
      : ["www.tiktok.com/v2/auth/authorize/"]
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowed.includes(`${url.hostname.toLowerCase()}${url.pathname}`)
  ) {
    throw new TypeError("Invalid authorization response")
  }
  return url.toString()
}

function providerAccessRemovalIncomplete(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const descriptor = Object.getOwnPropertyDescriptor(input, "providerAccessRemoved")
  return descriptor !== undefined && "value" in descriptor && descriptor.value === false
}

function boundedSignal(signal: AbortSignal) {
  return AbortSignal.any([signal, AbortSignal.timeout(15_000)])
}
