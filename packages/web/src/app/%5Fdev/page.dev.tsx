import Link from "next/link"
import { notFound } from "next/navigation"

export default function DevelopmentPlaygroundPage() {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <header className="max-w-2xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-600">
          Development playground
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">Product playgrounds</h1>
        <p className="text-sm leading-6 text-gray-600">
          Interactive, in-memory prototypes for testing complete workflows. Nothing here writes to
          an API or database.
        </p>
      </header>

      <section aria-labelledby="playgrounds-heading" className="border-t border-gray-200">
        <h2 id="playgrounds-heading" className="sr-only">
          Available playgrounds
        </h2>
        <Link
          href="/_dev/form-builder"
          className="group grid gap-5 border-b border-gray-200 py-6 transition-colors hover:bg-white sm:grid-cols-[1fr_auto] sm:items-center sm:px-5"
        >
          <span className="space-y-1">
            <span className="block text-base font-semibold text-gray-950">Form builder</span>
            <span className="block max-w-xl text-sm leading-6 text-gray-600">
              Build and preview a headless form using a realistic lead-qualification fixture.
            </span>
          </span>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-teal-600">
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
