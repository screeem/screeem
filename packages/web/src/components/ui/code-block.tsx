"use client"

import { cn } from "@/lib/utils"
import { useCopy } from "@/components/ui/copy-row"

/**
 * Terminal surface for JSON payloads, config snippets, and log output. Per the
 * Terminal Stays Dark rule it does not invert with the theme, and it scrolls
 * horizontally rather than wrapping so structure survives.
 */
export function CodeBlock({
  code,
  label,
  copyable = true,
  /** Suppresses copying while `code` is a placeholder, e.g. during loading. */
  disabled = false,
  className,
}: {
  readonly code: string
  readonly label?: string
  readonly copyable?: boolean
  readonly disabled?: boolean
  readonly className?: string
}) {
  const { copied, copy } = useCopy()

  return (
    <div className={className}>
      {label || copyable ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          {label ? (
            <span className="text-sm font-medium text-foreground">{label}</span>
          ) : (
            <span />
          )}
          {copyable ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => copy(code)}
              className="rounded-sm text-xs font-medium text-primary hover:text-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          ) : null}
        </div>
      ) : null}
      <pre
        className={cn(
          "overflow-x-auto rounded-md border border-code-border bg-code p-3",
          "font-mono text-xs leading-5 whitespace-pre text-code-foreground",
        )}
      >
        {code}
      </pre>
    </div>
  )
}
