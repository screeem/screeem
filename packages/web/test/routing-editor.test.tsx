// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ testFormRouting: vi.fn() }))

vi.mock("@screeem/forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@screeem/forms")>()),
  testFormRouting: mocks.testFormRouting,
}))

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: vi.fn(() => () => undefined),
  dropTargetForElements: vi.fn(() => () => undefined),
}))

vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  attachClosestEdge: vi.fn((data: Readonly<Record<string, unknown>>) => data),
  extractClosestEdge: vi.fn(() => null),
}))

import { RoutingEditor } from "../src/components/forms/RoutingEditor"
import type { FormActionTester } from "@screeem/forms"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("RoutingEditor", () => {
  it("keeps a required number included while its value is being replaced", async () => {
    mocks.testFormRouting.mockResolvedValueOnce({ route: "sales", matchedRule: null, actions: [] })
    const user = userEvent.setup()

    renderEditor()

    const employees = screen.getByRole("spinbutton", { name: "Employees" }) as HTMLInputElement
    await user.clear(employees)
    expect(employees.value).toBe("")
    expect(screen.queryByText("Not included in sample")).toBeNull()

    await user.type(employees, "850")
    await user.click(screen.getByRole("button", { name: "Test this response" }))

    expect(mocks.testFormRouting).toHaveBeenCalledWith(definition, routing, { employees: 850 })
  })

  it("does not show a late result for a sample that has since changed", async () => {
    const pending = deferredResult()
    mocks.testFormRouting.mockReturnValueOnce(pending.promise)
    const user = userEvent.setup()

    renderEditor()

    await user.click(screen.getByRole("button", { name: "Test this response" }))
    expect(mocks.testFormRouting).toHaveBeenCalledWith(definition, routing, { employees: 1 })
    fireEvent.change(screen.getByRole("spinbutton", { name: "Employees" }), {
      target: { value: "850" },
    })
    await act(async () => {
      pending.resolve({ route: "review", matchedRule: null, actions: [] })
    })

    expect(screen.getByRole("button", { name: "Test this response" })).toBeTruthy()
    expect(screen.queryByText("Destination")).toBeNull()
  })

  it("keeps the newest result when an older test finishes last", async () => {
    const first = deferredResult()
    const second = deferredResult()
    mocks.testFormRouting
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const user = userEvent.setup()

    renderEditor()

    await user.click(screen.getByRole("button", { name: "Test this response" }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "Employees" }), {
      target: { value: "850" },
    })
    await user.click(screen.getByRole("button", { name: "Test this response" }))

    await act(async () => {
      second.resolve({ route: "sales", matchedRule: null, actions: [] })
    })
    expect(screen.getByText("sales")).toBeTruthy()

    await act(async () => {
      first.resolve({ route: "review", matchedRule: null, actions: [] })
    })
    expect(screen.getByText("sales")).toBeTruthy()
    expect(screen.queryByText("review")).toBeNull()
  })

  it("runs an injected action tester against the current routing result", async () => {
    mocks.testFormRouting.mockResolvedValueOnce({
      route: "sales",
      matchedRule: "enterprise",
      actions: [],
    })
    const tester: FormActionTester = {
      actionName: "notifySales",
      label: "Notify sales",
      description: "Preview the notification.",
      test: vi.fn().mockResolvedValue({
        status: "success",
        summary: "Notification preview ready — nothing was sent.",
        details: [{ label: "Recipient", value: "routing-preview@notifications.invalid" }],
      }),
    }
    const user = userEvent.setup()

    renderEditor([tester])
    await user.click(screen.getByRole("button", { name: "Test this response" }))
    await user.click(screen.getByRole("button", { name: /Preview Notify sales/ }))

    await vi.waitFor(() => expect(tester.test).toHaveBeenCalledWith({
      definition,
      submission: { employees: 1 },
      routing: {
        status: "matched",
        route: "sales",
        matchedRule: "enterprise",
        error: null,
      },
      signal: expect.any(AbortSignal),
    }))
    expect(screen.getByText("Notification preview ready — nothing was sent.")).toBeTruthy()
    expect(screen.getByText("routing-preview@notifications.invalid")).toBeTruthy()
  })

  it("rejects malformed tester responses at the UI boundary", async () => {
    mocks.testFormRouting.mockResolvedValueOnce({ route: "review", matchedRule: null, actions: [] })
    const tester: FormActionTester = {
      actionName: "notifySales",
      label: "Notify sales",
      test: vi.fn().mockResolvedValue({ status: "success", summary: "" }),
    }
    const user = userEvent.setup()

    renderEditor([tester])
    await user.click(screen.getByRole("button", { name: "Test this response" }))
    await user.click(screen.getByRole("button", { name: "Preview Notify sales" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Action test summary is invalid")
  })

  it("discards an action preview when the sample changes", async () => {
    mocks.testFormRouting.mockResolvedValue({
      route: "sales",
      matchedRule: "enterprise",
      actions: [],
    })
    const pending = deferredActionResult()
    const tester: FormActionTester = {
      actionName: "notifySales",
      label: "Notify sales",
      test: vi.fn().mockReturnValue(pending.promise),
    }
    const user = userEvent.setup()

    renderEditor([tester])
    await user.click(screen.getByRole("button", { name: "Test this response" }))
    await user.click(screen.getByRole("button", { name: "Preview Notify sales" }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "Employees" }), {
      target: { value: "850" },
    })
    await act(async () => {
      pending.resolve({ status: "success", summary: "Stale notification preview" })
    })

    expect(screen.queryByText("Stale notification preview")).toBeNull()
    expect(screen.queryByRole("button", { name: "Preview Notify sales" })).toBeNull()
  })

  it("times out a tester and aborts its signal", async () => {
    mocks.testFormRouting.mockResolvedValue({ route: "review", matchedRule: null, actions: [] })
    let signal: AbortSignal | undefined
    const tester: FormActionTester = {
      actionName: "notifySales",
      label: "Notify sales",
      timeoutMs: 1,
      test: vi.fn((context) => {
        signal = context.signal
        return new Promise<never>(() => undefined)
      }),
    }
    const user = userEvent.setup()

    renderEditor([tester])
    await user.click(screen.getByRole("button", { name: "Test this response" }))
    await user.click(screen.getByRole("button", { name: "Preview Notify sales" }))

    expect((await screen.findByRole("alert")).textContent).toContain("cancelled or timed out")
    expect(signal?.aborted).toBe(true)
  })

  it("keeps an in-flight preview alive across an equivalent tester-list rerender", async () => {
    mocks.testFormRouting.mockResolvedValue({ route: "review", matchedRule: null, actions: [] })
    const pending = deferredActionResult()
    const tester: FormActionTester = {
      actionName: "notifySales",
      label: "Notify sales",
      test: vi.fn().mockReturnValue(pending.promise),
    }
    const user = userEvent.setup()
    const rendered = renderEditor([tester])

    await user.click(screen.getByRole("button", { name: "Test this response" }))
    await user.click(screen.getByRole("button", { name: "Preview Notify sales" }))
    rendered.rerender(editor([tester]))
    await act(async () => {
      pending.resolve({ status: "success", summary: "Preview survived rerender" })
    })

    expect(await screen.findByText("Preview survived rerender")).toBeTruthy()
  })
})

function renderEditor(actionTesters: readonly FormActionTester[] = []) {
  return render(editor(actionTesters))
}

function editor(actionTesters: readonly FormActionTester[]) {
  return (
    <RoutingEditor
      definition={definition}
      draft={routing}
      issues={[]}
      actionTesters={actionTesters}
      onAddRule={vi.fn()}
      onUpdateRule={vi.fn()}
      onRemoveRule={vi.fn()}
      onReorderRule={vi.fn()}
      onAddCondition={vi.fn()}
      onUpdateCondition={vi.fn()}
      onRemoveCondition={vi.fn()}
      onFallbackChange={vi.fn()}
    />
  )
}

const definition = {
  formatVersion: 1,
  title: "Qualification",
  submitLabel: "Submit",
  successMessage: "Thanks",
  fields: [
    {
      id: "employees",
      name: "employees",
      label: "Employees",
      required: true,
      type: "number",
      control: "number",
    },
  ],
} as const

const routing = {
  version: 1,
  rules: [
    {
      id: "enterprise",
      combinator: "all",
      conditions: [
        {
          id: "employees-condition",
          fieldId: "employees",
          operator: "greater_than_or_equal",
          value: 500,
        },
      ],
      route: "sales",
    },
  ],
  fallback: "review",
} as const

function deferredResult() {
  let resolve!: (value: { route: string; matchedRule: null; actions: never[] }) => void
  const promise = new Promise<{ route: string; matchedRule: null; actions: never[] }>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function deferredActionResult() {
  let resolve!: (value: { status: "success"; summary: string }) => void
  const promise = new Promise<{ status: "success"; summary: string }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
