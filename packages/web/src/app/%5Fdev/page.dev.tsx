import Link from "next/link"
import { notFound } from "next/navigation"

export default function DevelopmentPlaygroundPage() {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <header className="max-w-2xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Development playground
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Product playgrounds</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Interactive, in-memory prototypes for testing complete workflows. Nothing here writes to
          an API or database.
        </p>
      </header>

      <section aria-labelledby="playgrounds-heading" className="border-t border-border">
        <h2 id="playgrounds-heading" className="sr-only">
          Available playgrounds
        </h2>
        <Link
          href="/_dev/form-builder"
          className="group grid gap-5 border-b border-border py-6 transition-colors hover:bg-card sm:grid-cols-[1fr_auto] sm:items-center sm:px-5"
        >
          <span className="space-y-1">
            <span className="block text-base font-semibold text-foreground">Form builder</span>
            <span className="block max-w-xl text-sm leading-6 text-muted-foreground">
              Build and preview a headless form using a realistic lead-qualification fixture.
            </span>
          </span>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            Open playground
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
              →
            </span>
          </span>
        </Link>
        <Link
          href="/_dev/integrations"
          className="group grid gap-5 border-b border-border py-6 transition-colors hover:bg-card sm:grid-cols-[1fr_auto] sm:items-center sm:px-5"
        >
          <span className="space-y-1">
            <span className="block text-base font-semibold text-foreground">
              Integration management
            </span>
            <span className="block max-w-xl text-sm leading-6 text-muted-foreground">
              Review Salesforce connection, recovery, and provider-status states without external calls.
            </span>
          </span>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            Open playground
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
              →
            </span>
          </span>
        </Link>
      </section>
    </div>
  )
}
