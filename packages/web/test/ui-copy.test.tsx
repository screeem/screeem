// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CodeBlock } from "@/components/ui/code-block"
import { CopyRow } from "@/components/ui/copy-row"

function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
  return writeText
}

afterEach(cleanup)

describe("CopyRow", () => {
  it("copies the value and confirms, then reverts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const writeText = stubClipboard()
    render(<CopyRow label="Endpoint" value="https://example.com/api" />)

    await user.click(screen.getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith("https://example.com/api")
    expect(screen.getByRole("button", { name: "Copied!" })).toBeDefined()

    vi.advanceTimersByTime(2100)
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeDefined())
    vi.useRealTimers()
  })

  it("shows the placeholder and offers no copy affordance without a value", () => {
    render(<CopyRow label="Hosted form" placeholder="Publish to create a hosted form" />)

    expect(screen.getByText("Publish to create a hosted form")).toBeDefined()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("treats an empty value the same as a missing one", () => {
    render(<CopyRow label="Hosted form" value="" placeholder="Not published" />)

    expect(screen.getByText("Not published")).toBeDefined()
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("CodeBlock", () => {
  it("copies the rendered code", async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard()
    render(<CodeBlock label="Config" code={'{ "a": 1 }'} />)

    await user.click(screen.getByRole("button", { name: "Copy" }))
    expect(writeText).toHaveBeenCalledWith('{ "a": 1 }')
  })

  it("never copies a placeholder while disabled", async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard()
    render(<CodeBlock label="Config" code="Loading…" disabled />)

    const copy = screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement
    expect(copy.disabled).toBe(true)
    await user.click(copy).catch(() => undefined)
    expect(writeText).not.toHaveBeenCalled()
  })
})
