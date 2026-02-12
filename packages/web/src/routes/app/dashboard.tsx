import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useOrganizations, usePosts } from '../../lib/api/hooks'

export const Route = createFileRoute('/app/dashboard')({
  component: DashboardComponent,
})

function DashboardComponent() {
  const navigate = useNavigate()
  const { data: organizations, isLoading: orgsLoading } = useOrganizations()
  const firstOrgId = organizations?.[0]?.id
  const { data: postsData } = usePosts(firstOrgId || '', { limit: 5 })

  const posts = postsData?.posts || []
  const scheduledCount = posts.filter((p: any) => p.status === 'scheduled').length
  const publishedCount = posts.filter((p: any) => p.status === 'published').length

  if (orgsLoading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  if (!organizations || organizations.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Welcome to Screeem!</h2>
          <p className="text-muted-foreground">
            Get started by creating your first organization
          </p>
        </div>
        <div className="rounded-lg border-2 border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground mb-4">You don't have any organizations yet</p>
          <button
            onClick={() => navigate({ to: '/app/settings/organization' })}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Create Your First Organization
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Welcome to your social media scheduling platform
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Total Posts</h3>
          <p className="mt-2 text-3xl font-bold">{posts.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Scheduled</h3>
          <p className="mt-2 text-3xl font-bold">{scheduledCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Published</h3>
          <p className="mt-2 text-3xl font-bold">{publishedCount}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <button
              onClick={() => navigate({ to: '/app/posts/new', search: { orgId: firstOrgId || '' } })}
              className="w-full text-left px-4 py-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              + Schedule New Post
            </button>
            <button
              onClick={() => navigate({ to: '/app/posts' })}
              className="w-full text-left px-4 py-3 rounded-md border border-border hover:bg-secondary transition-colors"
            >
              View All Posts
            </button>
            <button
              onClick={() => navigate({ to: '/app/settings/organization' })}
              className="w-full text-left px-4 py-3 rounded-md border border-border hover:bg-secondary transition-colors"
            >
              Manage Organizations
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Posts</h3>
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts yet</p>
          ) : (
            <div className="space-y-3">
              {posts.slice(0, 3).map((post: any) => (
                <div key={post.id} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      post.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                      post.status === 'published' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {post.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(post.scheduledFor).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-muted-foreground truncate">{post.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
