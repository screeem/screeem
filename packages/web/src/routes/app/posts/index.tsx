import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useOrganizations, usePosts, useCancelPost } from '../../../lib/api/hooks'
import { useEventStore } from '../../../lib/event-store/store'
import { useSSE } from '../../../lib/sse/client'

export const Route = createFileRoute('/app/posts/')({
  component: PostsListComponent,
})

function PostsListComponent() {
  const navigate = useNavigate()
  const { data: organizations } = useOrganizations()
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')

  // Select first org by default
  const selectedOrg = organizations?.find((org: any) => org.id === selectedOrgId) || organizations?.[0]

  if (!selectedOrgId && selectedOrg) {
    setSelectedOrgId(selectedOrg.id)
  }

  // Fetch posts from API
  const { data: apiPosts, isLoading } = usePosts(selectedOrgId || '')

  // Get posts from local event store
  const localPosts = useEventStore((state) => {
    const posts = Array.from(state.posts.values())
    return posts.filter((p) => p.organizationId === selectedOrgId)
  })

  // Subscribe to SSE events
  useSSE(selectedOrgId || null, (event) => {
    useEventStore.getState().applyEvent(event)
  })

  // Use local posts if available, otherwise use API posts
  const posts = localPosts.length > 0 ? localPosts : (apiPosts?.posts || [])

  const cancelMutation = useCancelPost(selectedOrgId || '')

  const handleCancel = async (postId: string) => {
    if (!confirm('Are you sure you want to cancel this post?')) return
    try {
      await cancelMutation.mutateAsync({ postId, reason: 'Cancelled by user' })
    } catch (error: any) {
      alert(error.message)
    }
  }

  if (isLoading) {
    return <div className="text-muted-foreground">Loading posts...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Scheduled Posts</h2>
          <p className="text-muted-foreground">
            Manage your scheduled social media posts
          </p>
        </div>
        <button
          onClick={() => navigate({ to: '/app/posts/new', search: { orgId: selectedOrgId } })}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Schedule Post
        </button>
      </div>

      {organizations && organizations.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-2">Organization</label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {organizations.map((org: any) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-4">
        {posts.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border p-12 text-center">
            <p className="text-muted-foreground mb-4">No posts scheduled yet</p>
            <button
              onClick={() => navigate({ to: '/app/posts/new', search: { orgId: selectedOrgId } })}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Schedule Your First Post
            </button>
          </div>
        ) : (
          posts
            .sort((a: any, b: any) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
            .map((post: any) => (
              <PostCard
                key={post.id}
                post={post}
                onCancel={() => handleCancel(post.id)}
              />
            ))
        )}
      </div>
    </div>
  )
}

function PostCard({ post, onCancel }: { post: any; onCancel: () => void }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'publishing':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'published':
        return 'bg-green-100 text-green-800 border-green-200'
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200'
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 border-gray-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const scheduledDate = new Date(post.scheduledFor)
  const isUpcoming = scheduledDate > new Date()

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-block px-2 py-1 rounded text-xs font-medium border ${getStatusColor(
                post.status
              )}`}
            >
              {post.status}
            </span>
            {post.status === 'published' && post.tweetId && (
              <a
                href={`https://twitter.com/i/web/status/${post.tweetId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline"
              >
                View on Twitter →
              </a>
            )}
          </div>
          <div className="text-sm text-muted-foreground mb-2">
            {isUpcoming ? 'Scheduled for' : 'Was scheduled for'}{' '}
            {scheduledDate.toLocaleString()}
          </div>
        </div>
        {post.status === 'scheduled' && (
          <button
            onClick={onCancel}
            className="text-sm text-destructive hover:underline"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="mb-4">
        <p className="whitespace-pre-wrap">{post.content}</p>
      </div>

      {post.mediaUrls && post.mediaUrls.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          {post.mediaUrls.map((url: string, i: number) => (
            <img
              key={i}
              src={url}
              alt={`Media ${i + 1}`}
              className="h-20 w-20 rounded object-cover border border-border"
            />
          ))}
        </div>
      )}

      {post.error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          <strong>Error:</strong> {post.error}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border">
        <div>Created {new Date(post.createdAt).toLocaleDateString()}</div>
        {post.publishedAt && (
          <div>Published {new Date(post.publishedAt).toLocaleString()}</div>
        )}
      </div>
    </div>
  )
}
