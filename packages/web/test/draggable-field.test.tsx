// @vitest-environment jsdom

import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DraggableField } from "../src/components/forms/DraggableField"

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: vi.fn(() => () => undefined),
  dropTargetForElements: vi.fn(() => () => undefined),
}))

vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  attachClosestEdge: vi.fn((data: Readonly<Record<string, unknown>>) => ({
    ...data,
    closestEdge: "bottom",
  })),
  extractClosestEdge: vi.fn(() => "bottom"),
}))

vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index", () => ({
  getReorderDestinationIndex: vi.fn(() => 2),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DraggableField", () => {
  it("registers a dedicated handle and maps a field drop to its destination index", () => {
    const onReorder = vi.fn()

    render(
      <DraggableField fieldId="work-email" index={1} onReorder={onReorder}>
        {({ dragHandleRef }) => (
          <button ref={dragHandleRef} type="button">
            Drag work email
          </button>
        )}
      </DraggableField>,
    )

    const handle = screen.getByRole("button", { name: "Drag work email" })
    const draggableOptions = vi.mocked(draggable).mock.calls[0]?.[0]
    expect(draggableOptions?.dragHandle).toBe(handle)
    expect(draggableOptions?.element.dataset.fieldId).toBe("work-email")

    const dropOptions = vi.mocked(dropTargetForElements).mock.calls[0]?.[0]
    dropOptions?.onDrop?.({
      self: { data: { closestEdge: "bottom" } },
      source: { data: { type: "form-field", fieldId: "full-name", index: 0 } },
    } as unknown as Parameters<NonNullable<typeof dropOptions.onDrop>>[0])

    expect(getReorderDestinationIndex).toHaveBeenCalledWith({
      startIndex: 0,
      indexOfTarget: 1,
      closestEdgeOfTarget: "bottom",
      axis: "vertical",
    })
    expect(onReorder).toHaveBeenCalledWith("full-name", 2)
  })
})
