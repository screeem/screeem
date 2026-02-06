import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../lib/auth/context'
import { useEffect } from 'react'

export const Route = createFileRoute('/app/_layout')({
  component: AppLayout,
})

function AppLayout() {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/auth/login' })
    }
  }, [user, loading, navigate])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex">
              <div className="flex flex-shrink-0 items-center">
                <h1 className="text-xl font-bold">Screeem</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <a
                  href="/app/dashboard"
                  className="inline-flex items-center border-b-2 border-primary px-1 pt-1 text-sm font-medium text-foreground"
                >
                  Dashboard
                </a>
                <a
                  href="/app/posts"
                  className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-muted-foreground hover:border-border hover:text-foreground"
                >
                  Posts
                </a>
                <a
                  href="/app/settings/organization"
                  className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-muted-foreground hover:border-border hover:text-foreground"
                >
                  Organization
                </a>
                <a
                  href="/app/settings/twitter"
                  className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-muted-foreground hover:border-border hover:text-foreground"
                >
                  Twitter
                </a>
              </div>
            </div>
            <div className="flex items-center">
              <span className="mr-4 text-sm text-muted-foreground">{user.email}</span>
              <button
                onClick={() => signOut()}
                className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  )
}
