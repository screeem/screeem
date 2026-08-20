import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Workflow state: a `-subtle` surface with matching `-text`
 * foreground. Status is never colour alone — the label carries the meaning.
 */
export type StatusTone = "neutral" | "success" | "warning" | "error" | "info"

const toneClass: Record<StatusTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-success-subtle text-success-text",
  warning: "bg-warning-subtle text-warning-text",
  error: "bg-error-subtle text-error-text",
  info: "bg-info-subtle text-info-text",
}

export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  readonly tone?: StatusTone
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
