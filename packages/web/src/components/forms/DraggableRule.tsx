"use client"

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index"
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"

export function DraggableRule({
  ruleId,
  index,
  onReorder,
  children,
}: {
  readonly ruleId: string
  readonly index: number
  readonly onReorder: (ruleId: string, targetIndex: number) => void
  readonly children: (state: {
    readonly dragHandleRef: RefObject<HTMLButtonElement | null>
    readonly isDragging: boolean
  }) => ReactNode
}) {
  const ruleRef = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<HTMLButtonElement>(null)
  const onReorderRef = useRef(onReorder)
  const [isDragging, setIsDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    onReorderRef.current = onReorder
  }, [onReorder])

  useEffect(() => {
    const element = ruleRef.current
    const dragHandle = dragHandleRef.current
    if (!element || !dragHandle) return

    const data = { type: "routing-rule", ruleId, index }
    return combine(
      draggable({
        element,
        dragHandle,
        getInitialData: () => data,
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          source.data.type === "routing-rule" && source.data.ruleId !== ruleId,
        getData: ({ input, element: target }) =>
          attachClosestEdge(data, {
            input,
            element: target,
            allowedEdges: ["top", "bottom"],
          }),
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: ({ self, source }) => {
          setClosestEdge(null)
          const sourceRuleId = source.data.ruleId
          const sourceIndex = source.data.index
          if (typeof sourceRuleId !== "string" || typeof sourceIndex !== "number") return
          onReorderRef.current(
            sourceRuleId,
            getReorderDestinationIndex({
              startIndex: sourceIndex,
              indexOfTarget: index,
              closestEdgeOfTarget: extractClosestEdge(self.data),
              axis: "vertical",
            }),
          )
        },
      }),
    )
  }, [index, ruleId])

  return (
    <div
      ref={ruleRef}
      data-rule-id={ruleId}
      className={`relative transition-[opacity,transform] duration-150 ${
        isDragging ? "scale-[0.995] opacity-45" : ""
      }`}
    >
      {closestEdge ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-4 z-20 h-0.5 rounded-full bg-teal-500 ${
            closestEdge === "top" ? "-top-2" : "-bottom-2"
          }`}
        />
      ) : null}
      {children({ dragHandleRef, isDragging })}
    </div>
  )
}
