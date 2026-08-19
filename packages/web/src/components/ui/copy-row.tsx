"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/** Two seconds is long enough to read "Copied!" and short enough not to linger. */
const confirmationMs = 2000

export function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function copy(value: string) {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), confirmationMs)
  }

  return { copied, copy }
}

/**
 * The standard presentation for endpoints, hosted URLs, and key prefixes, per
 * anything a user would paste into a terminal or config file: a well, a
 * shrink-0 label, a truncating mono value, and a copy affordance.
 */
export function CopyRow({
  label,
  value,
  placeholder,
  className,
}: {
  readonly label: string
  /** Omit to render the row as unavailable, showing `placeholder` instead. */
  readonly value?: string
  readonly placeholder?: string
  readonly className?: string
}) {
  const { copied, copy } = useCopy()
  // A single predicate, so an empty-string value can never render a blank row
  // that also has no copy button.
  const hasValue = Boolean(value)

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md bg-muted px-3 py-2",
        className,
      )}
    >
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
        {hasValue ? value : placeholder}
      </code>
      {hasValue ? (
        <button
          type="button"
          onClick={() => copy(value as string)}
          className="shrink-0 rounded-sm text-xs font-medium text-primary hover:text-primary-hover"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      ) : null}
    </div>
  )
}
