// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Integrations } from "../src/app/dashboard/Integrations"

const teamOne = "72000000-0000-0000-0000-000000000001"
const teamTwo = "72000000-0000-0000-0000-000000000002"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("integration management", () => {
  it("starts a bounded Salesforce connection from the empty state", async () => {
    const navigate = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ integrations: [] }))
      .mockResolvedValueOnce(json({
        authorizationUrl:
          "https://login.salesforce.com/services/oauth2/authorize?client_id=client&state=state",
      }, 201))
    const user = userEvent.setup()

    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={fetcher}
        navigate={navigate}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "Connect Salesforce" }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      "https://login.salesforce.com/services/oauth2/authorize?client_id=client&state=state",
    ))
    expect(fetcher).toHaveBeenLastCalledWith(
      `/api/teams/${teamOne}/integrations/salesforce/connect`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ returnPath: "/dashboard/integrations" }),
      }),
    )
  })

  it("shows organization state and supports test and disconnect", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ integrations: [summary()] }))
      .mockResolvedValueOnce(json({ ok: true, limits: { remaining: 100, maximum: 1_000 } }))
      .mockResolvedValueOnce(json({ integrations: [summary({ health: "healthy" })] }))
      .mockResolvedValueOnce(json({ disconnected: true }))
      .mockResolvedValueOnce(json({ integrations: [] }))
    const user = userEvent.setup()

    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={fetcher}
        confirmDisconnect={() => true}
      />,
    )

    expect(await screen.findByText("Goldman Sachs")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Test connection" }))
    expect(await screen.findByText("Salesforce connection is healthy.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(await screen.findByText("Salesforce was disconnected.")).toBeTruthy()
    expect(await screen.findByRole("button", { name: "Connect Salesforce" })).toBeTruthy()
  })

  it("shows reconnect state without offering an unavailable connection test", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({
      integrations: [summary({
        status: "reauthorization_required",
        health: "degraded",
        availability: "connection_unavailable",
        lastErrorCode: "authentication_failed",
      })],
    }))

    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={fetcher}
      />,
    )

    expect(await screen.findByText("Reconnect required")).toBeTruthy()
    expect(screen.getByText("Salesforce authorization expired. Reconnect to continue.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull()
  })

  it("shows a fixed rate-limit message without exposing provider details", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({
      integrations: [summary({ health: "degraded", lastErrorCode: "rate_limited" })],
    }))

    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={fetcher}
      />,
    )

    expect(await screen.findByText("Salesforce is rate limited. Try again later.")).toBeTruthy()
    expect(screen.queryByText(/provider detail/i)).toBeNull()
  })

  it("keeps management controls hidden from ordinary members", async () => {
    render(
      <Integrations
        teamId={teamOne}
        canManage={false}
        oauthResult={null}
        fetcher={vi.fn().mockResolvedValue(json({ integrations: [summary()] }))}
      />,
    )

    expect(await screen.findByText("Only team owners and admins can manage integrations.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull()
  })

  it("discards a stale team response after the team changes", async () => {
    const first = deferredResponse()
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(json({ integrations: [summary({ displayName: "Team two org" })] }))
    const view = render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={fetcher}
      />,
    )

    view.rerender(
      <Integrations
        teamId={teamTwo}
        canManage
        oauthResult={null}
        fetcher={fetcher}
      />,
    )

    expect(await screen.findByText("Team two org")).toBeTruthy()
    first.resolve(json({ integrations: [summary({ displayName: "Stale team one org" })] }))
    await waitFor(() => expect(screen.queryByText("Stale team one org")).toBeNull())
  })
})

function summary(update: Record<string, unknown> = {}) {
  return {
    id: "71000000-0000-0000-0000-000000000001",
    provider: "salesforce",
    revision: 1,
    providerDisplayName: "Salesforce",
    status: "connected",
    health: "healthy",
    enabled: true,
    availability: "available",
    displayName: "Goldman Sachs",
    externalAccountId: "00D000000000001",
    lastErrorCode: null,
    lastCheckedAt: "2026-08-15T10:00:00.000Z",
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...update,
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
