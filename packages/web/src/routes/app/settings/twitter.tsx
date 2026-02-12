import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useOrganizations, useTwitterAccount, useDisconnectTwitter } from '../../../lib/api/hooks'

export const Route = createFileRoute('/app/settings/twitter')({
  component: TwitterSettingsComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    connected: (search.connected as string) || '',
    error: (search.error as string) || '',
  }),
})

function TwitterSettingsComponent() {
  const navigate = useNavigate()
  const { connected, error } = useSearch({ from: '/app/settings/twitter' })
  const { data: organizations } = useOrganizations()
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [isConnecting, setIsConnecting] = useState(false)

  // Select first org by default
  const selectedOrg = organizations?.find((org: any) => org.id === selectedOrgId) || organizations?.[0]

  if (!selectedOrgId && selectedOrg) {
    setSelectedOrgId(selectedOrg.id)
  }

  const { data: twitterAccount, isLoading, refetch } = useTwitterAccount(selectedOrgId || '')
  const disconnectMutation = useDisconnectTwitter(selectedOrgId || '')

  // Show success/error messages from OAuth callback
  useEffect(() => {
    if (connected === 'true') {
      alert('Twitter account connected successfully!')
      // Clear search params
      navigate({ to: '/app/settings/twitter', search: { connected: '', error: '' }, replace: true })
      refetch()
    } else if (error) {
      alert(`Failed to connect Twitter: ${error}`)
      // Clear search params
      navigate({ to: '/app/settings/twitter', search: { connected: '', error: '' }, replace: true })
    }
  }, [connected, error, navigate, refetch])

  const handleConnect = async () => {
    if (!selectedOrgId) {
      alert('Please select an organization')
      return
    }

    setIsConnecting(true)
    try {
      // Get OAuth URL from backend
      const response = await fetch(`/api/organizations/${selectedOrgId}/twitter/auth`, {
        headers: await getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error('Failed to initiate Twitter OAuth')
      }

      const data = await response.json()

      // Redirect to Twitter OAuth
      window.location.href = data.url
    } catch (error: any) {
      alert(error.message)
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Twitter account?')) {
      return
    }

    try {
      await disconnectMutation.mutateAsync()
      refetch()
    } catch (error: any) {
      alert(error.message)
    }
  }

  async function getAuthHeaders() {
    const { supabase } = await import('../../../lib/supabase')
    const {
      data: { session },
    } = await supabase.auth.getSession()

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    }
  }

  if (isLoading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Twitter Settings</h2>
        <p className="text-muted-foreground">
          Connect your Twitter account to publish scheduled posts
        </p>
      </div>

      {/* Organization Selector */}
      {organizations && organizations.length > 1 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="block text-sm font-medium mb-2">Organization</label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {organizations.map((org: any) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Twitter Connection Status */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="text-lg font-semibold mb-4">Connection Status</h3>

        {twitterAccount ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-md">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <svg
                    className="h-5 w-5 text-green-600"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-green-900">
                    @{twitterAccount.accountName}
                  </div>
                  <div className="text-sm text-green-700">Connected</div>
                </div>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="text-sm text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
              >
                {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>

            <div className="text-sm text-muted-foreground">
              <p>
                Your Twitter account is connected. Scheduled posts will be published to{' '}
                <a
                  href={`https://twitter.com/${twitterAccount.accountName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  @{twitterAccount.accountName}
                </a>
                .
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <div className="flex items-start gap-3">
                <svg
                  className="h-5 w-5 text-yellow-600 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div className="text-sm text-yellow-800">
                  <p className="font-medium mb-1">No Twitter account connected</p>
                  <p>
                    Connect a Twitter account to start publishing your scheduled posts
                    automatically.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleConnect}
              disabled={isConnecting || !selectedOrgId}
              className="w-full rounded-md bg-[#1DA1F2] px-4 py-3 text-sm font-medium text-white hover:bg-[#1a8cd8] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
              </svg>
              {isConnecting ? 'Connecting...' : 'Connect Twitter Account'}
            </button>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="text-lg font-semibold mb-3">How it works</h3>
        <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
          <li>Connect your Twitter account using OAuth 2.0 (secure authorization)</li>
          <li>Schedule posts from the Posts page</li>
          <li>
            Posts will be automatically published to Twitter at the scheduled time
          </li>
          <li>View published tweets directly from your post list</li>
        </ol>
      </div>
    </div>
  )
}
