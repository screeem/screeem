// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
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
  it("removes consumed OAuth result parameters from the address bar", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/integrations?integration=instagram&status=connected&reason=account_switch&tab=accounts",
    )

    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={{ provider: "instagram", status: "connected" }}
        fetcher={vi.fn().mockResolvedValue(json({ integrations: [] }))}
      />,
    )

    await waitFor(() => expect(window.location.search).toBe("?tab=accounts"))
  })

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

  it("starts Instagram authorization at the exact provider endpoint", async () => {
    const navigate = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ integrations: [] }))
      .mockResolvedValueOnce(json({
        authorizationUrl: `https://www.instagram.com/oauth/authorize?client_id=client&state=${"s".repeat(43)}`,
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

    await user.click(await screen.findByRole("button", { name: "Connect Instagram" }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      `https://www.instagram.com/oauth/authorize?client_id=client&state=${"s".repeat(43)}`,
    ))
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Connect Instagram" }).hasAttribute("disabled"),
    ).toBe(false))
    expect(fetcher).toHaveBeenLastCalledWith(
      `/api/teams/${teamOne}/integrations/instagram/connect`,
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("starts TikTok authorization at the exact provider endpoint", async () => {
    const navigate = vi.fn()
    const authorizationUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=client&state=${"s".repeat(43)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ integrations: [] }))
      .mockResolvedValueOnce(json({ authorizationUrl }, 201))
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

    await user.click(await screen.findByRole("button", { name: "Connect TikTok" }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(authorizationUrl))
  })

  it("rejects an authorization URL outside the exact provider host", async () => {
    const navigate = vi.fn()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ integrations: [] }))
      .mockResolvedValueOnce(json({
        authorizationUrl: "https://www.instagram.com.evil.example/oauth/authorize",
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

    await user.click(await screen.findByRole("button", { name: "Connect Instagram" }))

    expect(await screen.findByText("Could not start Instagram authorization.")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
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
      />,
    )

    expect((await screen.findAllByText("Goldman Sachs")).length).toBeGreaterThan(0)
    await user.click(screen.getByRole("button", { name: "Test connection" }))
    expect(await screen.findByText("Salesforce connection is healthy.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(within(screen.getByRole("alertdialog")).getByText("Disconnect Salesforce?")).toBeTruthy()
    expect(within(screen.getByRole("alertdialog")).getByText(
      /does not delete your Salesforce account or sign you out of Salesforce/i,
    )).toBeTruthy()
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Disconnect" }))
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }))
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

    expect((await screen.findAllByText("Only team owners and admins can manage integrations.")).length).toBe(3)
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Connect / })).toBeNull()
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull()
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

    expect((await screen.findAllByText("Team two org")).length).toBeGreaterThan(0)
    first.resolve(json({ integrations: [summary({ displayName: "Stale team one org" })] }))
    await waitFor(() => expect(screen.queryByText("Stale team one org")).toBeNull())
  })

  it("discards an older overlapping load for the same team", async () => {
    const first = deferredResponse()
    const initialFetcher = vi.fn().mockReturnValueOnce(first.promise)
    const refreshedFetcher = vi.fn().mockResolvedValueOnce(json({
      integrations: [summary({ displayName: "Current organization" })],
    }))
    const view = render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={initialFetcher}
      />,
    )

    view.rerender(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={refreshedFetcher}
      />,
    )

    expect((await screen.findAllByText("Current organization")).length).toBeGreaterThan(0)
    first.resolve(json({ integrations: [summary({ displayName: "Outdated organization" })] }))
    await waitFor(() => expect(screen.queryByText("Outdated organization")).toBeNull())
  })

  it("does not show stale account details for a persisted disconnected row", async () => {
    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={vi.fn().mockResolvedValue(json({
          integrations: [socialSummary({
            status: "disconnected",
            enabled: false,
            availability: "connection_disabled",
            displayName: "@old-account",
          })],
        }))}
      />,
    )

    expect(await screen.findByRole("button", { name: "Connect Instagram" })).toBeTruthy()
    expect(screen.queryByText("@old-account")).toBeNull()
  })

  it("withholds connection controls when the integration list fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "failed" }, 500))
      .mockResolvedValueOnce(json({ integrations: [] }))
    const user = userEvent.setup()
    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={fetcher}
      />,
    )

    expect(await screen.findByText("Could not load integrations. Connection controls are unavailable.")).toBeTruthy()
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: "Connect Instagram" })).toBeNull()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("button", { name: "Connect Instagram" })).toBeTruthy()
  })

  it("keeps a failed remote disconnect visibly retryable", async () => {
    const disconnecting = socialSummary({
      status: "disconnecting",
      enabled: false,
      availability: "connection_disabled",
    })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ integrations: [disconnecting] }))
      .mockResolvedValueOnce(json({ error: "Unable to disconnect Instagram" }, 502))
      .mockResolvedValueOnce(json({ integrations: [disconnecting] }))
    const user = userEvent.setup()
    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={fetcher}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "Retry disconnect" }))
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }))

    expect(await screen.findByText("Could not disconnect Instagram. Try again.")).toBeTruthy()
    expect(screen.getByText("Provider revocation did not finish. Publishing is disabled; retry disconnect to finish.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Retry disconnect" })).toBeTruthy()
  })

  it("explains when provider cleanup must be finished in account settings", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ integrations: [socialSummary()] }))
      .mockResolvedValueOnce(json({ disconnected: true, providerAccessRemoved: false }))
      .mockResolvedValueOnce(json({ integrations: [] }))
    const user = userEvent.setup()
    render(
      <Integrations
        teamId={teamOne}
        canManage
        oauthResult={null}
        fetcher={fetcher}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "Disconnect" }))
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }))

    expect(await screen.findByText(
      "Instagram was disconnected from Screeem. Remove Screeem from the account’s app permissions to finish provider cleanup.",
    )).toBeTruthy()
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

function socialSummary(update: Record<string, unknown> = {}) {
  return {
    ...summary(),
    id: "71000000-0000-0000-0000-000000000002",
    provider: "instagram",
    providerDisplayName: "Instagram",
    displayName: "@studio",
    externalAccountId: "instagram-account-one",
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
