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
})

function renderEditor() {
  return render(
    <RoutingEditor
      definition={definition}
      draft={routing}
      issues={[]}
      onAddRule={vi.fn()}
      onUpdateRule={vi.fn()}
      onRemoveRule={vi.fn()}
      onReorderRule={vi.fn()}
      onAddCondition={vi.fn()}
      onUpdateCondition={vi.fn()}
      onRemoveCondition={vi.fn()}
      onFallbackChange={vi.fn()}
    />,
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
