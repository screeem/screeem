import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useOrganizations, useSchedulePost } from '../../../lib/api/hooks'
import { useEventStore } from '../../../lib/event-store/store'
import { randomUUID } from '../../../lib/utils'
import { POST_EVENT_TYPES } from '@screeem/shared/types/events'

export const Route = createFileRoute('/app/posts/new')({
  component: NewPostComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    orgId: (search.orgId as string) || '',
  }),
})

function NewPostComponent() {
  const navigate = useNavigate()
  const { orgId: initialOrgId } = useSearch({ from: '/app/posts/new' })
  const { data: organizations } = useOrganizations()

  const [selectedOrgId, setSelectedOrgId] = useState(initialOrgId)
  const [content, setContent] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')

  const scheduleMutation = useSchedulePost(selectedOrgId || '')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedOrgId) {
      alert('Please select an organization')
      return
    }

    // Combine date and time
    const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`)

    if (scheduledFor <= new Date()) {
      alert('Scheduled time must be in the future')
      return
    }

    // Create optimistic event
    const optimisticId = randomUUID()
    const postId = randomUUID()

    const optimisticEvent = {
      id: randomUUID(),
      streamId: selectedOrgId,
      streamType: 'post-timeline' as const,
      eventType: POST_EVENT_TYPES.POST_SCHEDULED,
      eventVersion: 1,
      payload: {
        postId,
        content,
        mediaUrls: [],
        scheduledFor: scheduledFor.toISOString(),
        createdBy: 'current-user', // This will be set by backend
      },
      metadata: {
        userId: 'current-user',
        timestamp: new Date().toISOString(),
      },
      sequence: 0, // Will be set by backend
      streamSequence: 0, // Will be set by backend
      createdAt: new Date(),
    }

    // Apply optimistically
    useEventStore.getState().applyOptimisticEvent(optimisticEvent, optimisticId)

    try {
      // Send to backend
      await scheduleMutation.mutateAsync({
        content,
        scheduledFor: scheduledFor.toISOString(),
        mediaUrls: [],
      })

      // Backend will send confirmed event via SSE
      // For now, just navigate back
      navigate({ to: '/app/posts' })
    } catch (error: any) {
      // Rollback optimistic update
      useEventStore.getState().rollbackOptimisticEvent(optimisticId)
      alert(error.message)
    }
  }

  // Set default date/time
  if (!scheduledDate || !scheduledTime) {
    const now = new Date()
    now.setHours(now.getHours() + 1) // Default to 1 hour from now

    if (!scheduledDate) {
      setScheduledDate(now.toISOString().split('T')[0])
    }
    if (!scheduledTime) {
      setScheduledTime(now.toTimeString().slice(0, 5))
    }
  }

  const charCount = content.length
  const maxChars = 280

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button
          onClick={() => navigate({ to: '/app/posts' })}
          className="text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          ← Back to Posts
        </button>
        <h2 className="text-2xl font-bold tracking-tight">Schedule New Post</h2>
        <p className="text-muted-foreground">
          Create and schedule a post to Twitter
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Organization Selection */}
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="block text-sm font-medium mb-2">Organization</label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          >
            <option value="">Select organization...</option>
            {organizations?.map((org: any) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>

        {/* Post Content */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">Post Content</label>
            <span
              className={`text-sm ${
                charCount > maxChars ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {charCount} / {maxChars}
            </span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            placeholder="What's happening?"
            required
          />
          {charCount > maxChars && (
            <p className="text-sm text-destructive mt-2">
              Tweet is too long. Twitter has a 280 character limit.
            </p>
          )}
        </div>

        {/* Schedule Time */}
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="block text-sm font-medium mb-3">Schedule For</label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Date</label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Time</label>
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                required
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-sm font-medium mb-3">Preview</h3>
          <div className="rounded-md bg-secondary p-4">
            <div className="flex gap-3">
              <div className="h-10 w-10 rounded-full bg-muted" />
              <div className="flex-1">
                <div className="font-medium text-sm mb-1">Your Organization</div>
                <p className="text-sm whitespace-pre-wrap">{content || 'Your post content will appear here...'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: '/app/posts' })}
            className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={scheduleMutation.isPending || charCount > maxChars || !content.trim()}
            className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {scheduleMutation.isPending ? 'Scheduling...' : 'Schedule Post'}
          </button>
        </div>
      </form>
    </div>
  )
}
