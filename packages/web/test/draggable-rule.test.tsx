// @vitest-environment jsdom

import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DraggableRule } from "../src/components/forms/DraggableRule"

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: vi.fn(() => () => undefined),
  dropTargetForElements: vi.fn(() => () => undefined),
}))

vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  attachClosestEdge: vi.fn((data: Readonly<Record<string, unknown>>) => ({
    ...data,
    closestEdge: "top",
  })),
  extractClosestEdge: vi.fn(() => "top"),
}))

vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index", () => ({
  getReorderDestinationIndex: vi.fn(() => 0),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DraggableRule", () => {
  it("uses a dedicated handle and maps a rule drop to its ordered destination", () => {
    const onReorder = vi.fn()

    render(
      <DraggableRule ruleId="enterprise" index={1} onReorder={onReorder}>
        {({ dragHandleRef }) => (
          <button ref={dragHandleRef} type="button">
            Drag enterprise rule
          </button>
        )}
      </DraggableRule>,
    )

    const handle = screen.getByRole("button", { name: "Drag enterprise rule" })
    const draggableOptions = vi.mocked(draggable).mock.calls[0]?.[0]
    expect(draggableOptions?.dragHandle).toBe(handle)
    expect(draggableOptions?.element.dataset.ruleId).toBe("enterprise")

    const dropOptions = vi.mocked(dropTargetForElements).mock.calls[0]?.[0]
    dropOptions?.onDrop?.({
      self: { data: { closestEdge: "top" } },
      source: { data: { type: "routing-rule", ruleId: "commercial", index: 2 } },
    } as unknown as Parameters<NonNullable<typeof dropOptions.onDrop>>[0])

    expect(getReorderDestinationIndex).toHaveBeenCalledWith({
      startIndex: 2,
      indexOfTarget: 1,
      closestEdgeOfTarget: "top",
      axis: "vertical",
    })
    expect(onReorder).toHaveBeenCalledWith("commercial", 0)
  })
})
