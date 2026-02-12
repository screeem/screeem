import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexComponent,
})

function IndexComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="max-w-2xl px-4 text-center">
        <h1 className="mb-4 text-6xl font-bold">Screeem</h1>
        <p className="mb-8 text-xl text-muted-foreground">
          Social Media Scheduling Platform
        </p>
        <div className="flex gap-4 justify-center">
          <a
            href="/auth/login"
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Get Started
          </a>
        </div>
      </div>
    </div>
  )
}
