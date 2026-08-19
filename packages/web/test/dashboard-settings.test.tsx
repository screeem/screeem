// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiSettings } from "@/app/dashboard/ApiSettings"
import { McpSetup } from "@/app/dashboard/McpSetup"

function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("McpSetup", () => {
  it("never puts the loading placeholder on the clipboard", async () => {
    // Hold the key request open so the config block stays in its loading state.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))
    const user = userEvent.setup()
    const writeText = stubClipboard()

    renderWithQuery(<McpSetup teamId="team-1" />)
    await user.click(screen.getByRole("button", { name: "Claude Desktop" }))

    expect(screen.getByText("Loading…", { selector: "pre" })).toBeDefined()
    const copyButtons = screen
      .getAllByRole("button", { name: "Copy" })
      .filter((button) => (button as HTMLButtonElement).disabled)
    expect(copyButtons.length).toBeGreaterThan(0)

    for (const button of copyButtons) {
      await user.click(button).catch(() => undefined)
    }
    expect(writeText).not.toHaveBeenCalledWith("Loading…")
  })

  it("copies the real config once the key resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ key: "sk-test-123" })))),
    )
    const user = userEvent.setup()
    const writeText = stubClipboard()

    renderWithQuery(<McpSetup teamId="team-1" />)
    await user.click(screen.getByRole("button", { name: "Claude Desktop" }))
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull())

    const configCopy = screen
      .getAllByRole("button", { name: "Copy" })
      .find((button) => !(button as HTMLButtonElement).disabled)
    await user.click(configCopy!)

    expect(writeText).toHaveBeenCalled()
    expect(String(writeText.mock.calls.at(0)?.at(0))).toContain("sk-test-123")
  })
})

describe("ApiSettings", () => {
  it("tells a member without permission why the controls are absent", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))
    renderWithQuery(<ApiSettings teamId="team-1" canManage={false} />)

    expect(
      screen.getByText("Only team owners and admins can manage API keys."),
    ).toBeDefined()
    expect(screen.queryByRole("button", { name: "Create key" })).toBeNull()
  })

  it("shows a created secret once, outside any live region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              init?.method === "POST"
                ? { key: { id: "k1", name: "Production", key_prefix: "sk_live_a" }, secret: "sk_live_abcdef" }
                : { keys: [] },
            ),
          ),
        ),
      ),
    )
    const user = userEvent.setup()
    renderWithQuery(<ApiSettings teamId="team-1" canManage />)

    await user.type(screen.getByPlaceholderText("Key name, e.g. Production"), "Production")
    await user.click(screen.getByRole("button", { name: "Create key" }))

    const secret = await screen.findByText("sk_live_abcdef")
    expect(secret).toBeDefined()
    // The secret must not sit in a live region that reads it aloud unprompted.
    expect(secret.closest('[role="status"]')).toBeNull()
    expect(secret.closest('[role="alert"]')).toBeNull()
  })
})
