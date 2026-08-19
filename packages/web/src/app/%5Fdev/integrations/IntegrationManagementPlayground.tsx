"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { Integrations } from "../../dashboard/Integrations"

type Scenario = "disconnected" | "connected" | "expired" | "rate_limited"

const teamId = "72000000-0000-0000-0000-000000000001"

const scenarios: readonly { readonly id: Scenario; readonly label: string }[] = [
  { id: "disconnected", label: "Disconnected" },
  { id: "connected", label: "Connected" },
  { id: "expired", label: "Expired token" },
  { id: "rate_limited", label: "Rate limited" },
]

export function IntegrationManagementPlayground() {
  const [scenario, setScenario] = useState<Scenario>("disconnected")
  const [canManage, setCanManage] = useState(true)
  const [oauthMessage, setOauthMessage] = useState("")
  const scenarioRef = useRef<Scenario>(scenario)

  function choose(next: Scenario) {
    scenarioRef.current = next
    setScenario(next)
    setOauthMessage("")
  }

  const [fetcher] = useState<typeof fetch>(() => {
    const localFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      if (init?.method === "DELETE") {
        scenarioRef.current = "disconnected"
        setScenario("disconnected")
        setOauthMessage("Disconnect simulated locally. No request was sent to Salesforce.")
        return json({ disconnected: true })
      }
      if (url.endsWith("/test") && init?.method === "POST") {
        if (scenarioRef.current === "rate_limited") {
          return json({ error: "Salesforce is rate limited" }, 429)
        }
        return json({ ok: true, limits: { remaining: 14_500, maximum: 15_000 } })
      }
      if (
        (url.endsWith("/connect") || url.endsWith("/reconnect")) &&
        init?.method === "POST"
      ) {
        return json({
          authorizationUrl:
            "https://login.salesforce.com/services/oauth2/authorize?client_id=development&state=preview",
        }, 201)
      }
      return json({ integrations: integrationResponse(scenarioRef.current) })
    }
    return localFetch
  })

  function simulateAuthorization() {
    scenarioRef.current = "connected"
    setScenario("connected")
    setOauthMessage("OAuth redirect simulated locally. No request was sent to Salesforce.")
  }

  return (
    <main className="min-h-screen bg-muted px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/_dev" className="text-sm font-medium text-primary hover:text-primary-hover">
          ← Development playgrounds
        </Link>
        <header className="mt-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Development playground
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Integration management</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Review the real dashboard component against in-memory Salesforce states. Actions are
            simulated locally and never contact an API, database, or provider.
          </p>
        </header>

        <section className="mt-7 flex flex-wrap items-center gap-2 border-y border-border py-4">
          {scenarios.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => choose(item.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                scenario === item.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent"
              }`}
            >
              {item.label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={canManage}
              onChange={(event) => setCanManage(event.target.checked)}
              className="size-4 rounded border-border"
            />
            Manager controls
          </label>
        </section>

        {oauthMessage ? (
          <p role="status" className="mt-5 border-l-2 border-info bg-info-subtle px-4 py-3 text-sm text-info-text">
            {oauthMessage}
          </p>
        ) : null}

        <Integrations
          key={`${scenario}:${canManage}`}
          teamId={teamId}
          canManage={canManage}
          oauthResult={null}
          fetcher={fetcher}
          navigate={simulateAuthorization}
          confirmDisconnect={() => true}
        />
      </div>
    </main>
  )
}

function integrationResponse(scenario: Scenario) {
  if (scenario === "disconnected") return []
  return [summary(scenario)]
}

function summary(scenario: Exclude<Scenario, "disconnected">) {
  const expired = scenario === "expired"
  const limited = scenario === "rate_limited"
  return {
    id: "71000000-0000-0000-0000-000000000001",
    provider: "salesforce",
    revision: 3,
    providerDisplayName: "Salesforce",
    status: expired ? "reauthorization_required" : "connected",
    health: expired || limited ? "degraded" : "healthy",
    enabled: true,
    availability: expired ? "connection_unavailable" : "available",
    displayName: "Goldman Sachs",
    externalAccountId: "00D000000000001",
    lastErrorCode: expired
      ? "authentication_failed"
      : limited
        ? "rate_limited"
        : null,
    lastCheckedAt: "2026-08-15T10:00:00.000Z",
    createdAt: "2026-08-14T09:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
  }
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }))
}
