import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export const Route = createFileRoute('/auth/callback')({
  component: CallbackComponent,
})

function CallbackComponent() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Handle the OAuth callback
    const handleCallback = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) throw error

        if (data.session) {
          // Successfully authenticated, redirect to app
          navigate({ to: '/app/dashboard' })
        } else {
          throw new Error('No session found')
        }
      } catch (err: any) {
        setError(err.message || 'Authentication failed')
        // Redirect to login after a delay
        setTimeout(() => {
          navigate({ to: '/auth/login' })
        }, 3000)
      }
    }

    handleCallback()
  }, [navigate])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-destructive">Authentication Error</h2>
          <p className="mt-2 text-muted-foreground">{error}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            Redirecting to login...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
        <p className="mt-4 text-sm text-muted-foreground">
          Completing authentication...
        </p>
      </div>
    </div>
  )
}
