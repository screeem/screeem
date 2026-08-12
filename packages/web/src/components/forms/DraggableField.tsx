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

interface DraggableFieldRenderState {
  readonly dragHandleRef: RefObject<HTMLButtonElement | null>
  readonly isDragging: boolean
}

export function DraggableField({
  fieldId,
  index,
  onReorder,
  children,
}: {
  readonly fieldId: string
  readonly index: number
  readonly onReorder: (fieldId: string, targetIndex: number) => void
  readonly children: (state: DraggableFieldRenderState) => ReactNode
}) {
  const fieldRef = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<HTMLButtonElement>(null)
  const onReorderRef = useRef(onReorder)
  const [isDragging, setIsDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    onReorderRef.current = onReorder
  }, [onReorder])

  useEffect(() => {
    const element = fieldRef.current
    const dragHandle = dragHandleRef.current
    if (!element || !dragHandle) return

    const data = { type: "form-field", fieldId, index }
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
          source.data.type === "form-field" && source.data.fieldId !== fieldId,
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
          const sourceFieldId = source.data.fieldId
          const sourceIndex = source.data.index
          if (typeof sourceFieldId !== "string" || typeof sourceIndex !== "number") return

          const targetIndex = getReorderDestinationIndex({
            startIndex: sourceIndex,
            indexOfTarget: index,
            closestEdgeOfTarget: extractClosestEdge(self.data),
            axis: "vertical",
          })
          onReorderRef.current(sourceFieldId, targetIndex)
        },
      }),
    )
  }, [fieldId, index])

  return (
    <div
      ref={fieldRef}
      data-field-id={fieldId}
      className={`relative transition-[opacity,transform] duration-150 ${
        isDragging ? "scale-[0.99] opacity-40" : ""
      }`}
    >
      {closestEdge ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-2 z-20 h-0.5 rounded-full bg-teal-500 ${
            closestEdge === "top" ? "-top-1" : "-bottom-1"
          }`}
        />
      ) : null}
      {children({ dragHandleRef, isDragging })}
    </div>
  )
}
