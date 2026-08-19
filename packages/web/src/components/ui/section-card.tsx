import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A page-level section: card surface, 0.75rem radius, a title
 * and a one-line muted description, then content. No card inside a card — nest
 * with a border or a well instead.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  readonly title?: React.ReactNode
  readonly description?: React.ReactNode
  readonly actions?: React.ReactNode
}) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card p-6", className)}
      {...props}
    >
      {title || actions ? (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
