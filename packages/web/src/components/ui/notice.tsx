import * as React from "react"

import { cn } from "@/lib/utils"

export type NoticeTone = "info" | "success" | "warning" | "error"

const toneClass: Record<NoticeTone, string> = {
  info: "border-info bg-info-subtle text-info-text",
  success: "border-success bg-success-subtle text-success-text",
  warning: "border-warning bg-warning-subtle text-warning-text",
  error: "border-error bg-error-subtle text-error-text",
}

/**
 * Inline notice: a 2px semantic left border over the matching
 * `-subtle` surface. Errors take `role="alert"`; everything else `role="status"`.
 */
export function Notice({
  tone = "info",
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & { readonly tone?: NoticeTone }) {
  // Errors announce as alerts and everything else as a status, unless the
  // caller opts out — content the user just triggered themselves (a revealed
  // secret, say) should not be read aloud again by a live region.
  const role = "role" in props ? props.role : tone === "error" ? "alert" : "status"

  return (
    <div
      role={role}
      className={cn(
        "border-l-2 px-4 py-3 text-sm leading-6",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
