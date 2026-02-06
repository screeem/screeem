import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PostTimelineAggregate } from './post-timeline.js'
import { POST_EVENT_TYPES } from '@screeem/shared'

// Mock randomUUID to return predictable IDs
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-post-id'),
}))

describe('PostTimelineAggregate', () => {
  let aggregate: PostTimelineAggregate
  const orgId = 'org-123'
  const userId = 'user-456'

  // Helper to create a future date
  const futureDate = () => {
    const date = new Date()
    date.setDate(date.getDate() + 1) // Tomorrow
    return date
  }

  beforeEach(() => {
    aggregate = new PostTimelineAggregate(orgId)
  })

  describe('constructor', () => {
    it('should initialize with organization ID', () => {
      expect(aggregate.id).toBe(orgId)
    })

    it('should start with no posts', () => {
      expect(aggregate.getPosts()).toEqual([])
    })
  })

  describe('schedulePost', () => {
    it('should schedule a valid post', () => {
      const scheduledFor = futureDate()
      const postId = aggregate.schedulePost({
        content: 'Hello world!',
        scheduledFor,
        userId,
      })

      expect(postId).toBe('test-post-id')

      const post = aggregate.getPost(postId)
      expect(post).toBeDefined()
      expect(post?.content).toBe('Hello world!')
      expect(post?.status).toBe('scheduled')
      expect(post?.createdBy).toBe(userId)
    })

    it('should trim content whitespace', () => {
      const postId = aggregate.schedulePost({
        content: '  Hello world!  ',
        scheduledFor: futureDate(),
        userId,
      })

      const post = aggregate.getPost(postId)
      expect(post?.content).toBe('Hello world!')
    })

    it('should include media URLs', () => {
      const mediaUrls = ['https://example.com/img1.jpg', 'https://example.com/img2.jpg']
      const postId = aggregate.schedulePost({
        content: 'Post with media',
        scheduledFor: futureDate(),
        mediaUrls,
        userId,
      })

      const post = aggregate.getPost(postId)
      expect(post?.mediaUrls).toEqual(mediaUrls)
    })

    it('should default mediaUrls to empty array', () => {
      const postId = aggregate.schedulePost({
        content: 'No media',
        scheduledFor: futureDate(),
        userId,
      })

      const post = aggregate.getPost(postId)
      expect(post?.mediaUrls).toEqual([])
    })

    it('should produce PostScheduled event', () => {
      aggregate.schedulePost({
        content: 'Test post',
        scheduledFor: futureDate(),
        userId,
      })

      const events = aggregate.getUncommittedEvents()
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe(POST_EVENT_TYPES.POST_SCHEDULED)
    })

    it('should reject empty content', () => {
      expect(() =>
        aggregate.schedulePost({
          content: '',
          scheduledFor: futureDate(),
          userId,
        })
      ).toThrow('Post content cannot be empty')
    })

    it('should reject whitespace-only content', () => {
      expect(() =>
        aggregate.schedulePost({
          content: '   ',
          scheduledFor: futureDate(),
          userId,
        })
      ).toThrow('Post content cannot be empty')
    })

    it('should reject content exceeding 280 characters', () => {
      const longContent = 'a'.repeat(281)
      expect(() =>
        aggregate.schedulePost({
          content: longContent,
          scheduledFor: futureDate(),
          userId,
        })
      ).toThrow('Post content cannot exceed 280 characters')
    })

    it('should accept content with exactly 280 characters', () => {
      const exactContent = 'a'.repeat(280)
      expect(() =>
        aggregate.schedulePost({
          content: exactContent,
          scheduledFor: futureDate(),
          userId,
        })
      ).not.toThrow()
    })

    it('should reject past scheduled time', () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1) // Yesterday

      expect(() =>
        aggregate.schedulePost({
          content: 'Test',
          scheduledFor: pastDate,
          userId,
        })
      ).toThrow('Scheduled time must be in the future')
    })

    it('should reject more than 4 media items', () => {
      const mediaUrls = [
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
        'https://example.com/3.jpg',
        'https://example.com/4.jpg',
        'https://example.com/5.jpg',
      ]

      expect(() =>
        aggregate.schedulePost({
          content: 'Too many images',
          scheduledFor: futureDate(),
          mediaUrls,
          userId,
        })
      ).toThrow('Cannot attach more than 4 media items')
    })

    it('should accept exactly 4 media items', () => {
      const mediaUrls = [
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
        'https://example.com/3.jpg',
        'https://example.com/4.jpg',
      ]

      expect(() =>
        aggregate.schedulePost({
          content: 'Four images',
          scheduledFor: futureDate(),
          mediaUrls,
          userId,
        })
      ).not.toThrow()
    })
  })

  describe('updatePost', () => {
    let postId: string

    beforeEach(() => {
      postId = aggregate.schedulePost({
        content: 'Original content',
        scheduledFor: futureDate(),
        userId,
      })
      aggregate.markEventsAsCommitted()
    })

    it('should update post content', () => {
      aggregate.updatePost({
        postId,
        content: 'Updated content',
        scheduledFor: futureDate(),
      })

      const post = aggregate.getPost(postId)
      expect(post?.content).toBe('Updated content')
    })

    it('should update scheduled time', () => {
      const newDate = new Date()
      newDate.setDate(newDate.getDate() + 7) // One week later

      aggregate.updatePost({
        postId,
        content: 'Same content',
        scheduledFor: newDate,
      })

      const post = aggregate.getPost(postId)
      expect(post?.scheduledFor.getTime()).toBe(newDate.getTime())
    })

    it('should produce PostUpdated event', () => {
      aggregate.updatePost({
        postId,
        content: 'Updated',
        scheduledFor: futureDate(),
      })

      const events = aggregate.getUncommittedEvents()
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe(POST_EVENT_TYPES.POST_UPDATED)
    })

    it('should reject non-existent post', () => {
      expect(() =>
        aggregate.updatePost({
          postId: 'non-existent',
          content: 'Test',
          scheduledFor: futureDate(),
        })
      ).toThrow('Post not found')
    })

    it('should reject empty content', () => {
      expect(() =>
        aggregate.updatePost({
          postId,
          content: '',
          scheduledFor: futureDate(),
        })
      ).toThrow('Post content cannot be empty')
    })

    it('should reject content exceeding 280 characters', () => {
      expect(() =>
        aggregate.updatePost({
          postId,
          content: 'a'.repeat(281),
          scheduledFor: futureDate(),
        })
      ).toThrow('Post content cannot exceed 280 characters')
    })
  })

  describe('cancelPost', () => {
    let postId: string

    beforeEach(() => {
      postId = aggregate.schedulePost({
        content: 'To be cancelled',
        scheduledFor: futureDate(),
        userId,
      })
      aggregate.markEventsAsCommitted()
    })

    it('should cancel a scheduled post', () => {
      aggregate.cancelPost({
        postId,
        reason: 'No longer needed',
      })

      const post = aggregate.getPost(postId)
      expect(post?.status).toBe('cancelled')
    })

    it('should produce PostCancelled event', () => {
      aggregate.cancelPost({
        postId,
        reason: 'Test cancellation',
      })

      const events = aggregate.getUncommittedEvents()
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe(POST_EVENT_TYPES.POST_CANCELLED)
    })

    it('should reject non-existent post', () => {
      expect(() =>
        aggregate.cancelPost({
          postId: 'non-existent',
          reason: 'Test',
        })
      ).toThrow('Post not found')
    })

    it('should reject cancelling already cancelled post', () => {
      aggregate.cancelPost({ postId, reason: 'First cancel' })
      aggregate.markEventsAsCommitted()

      expect(() =>
        aggregate.cancelPost({
          postId,
          reason: 'Second cancel',
        })
      ).toThrow('Can only cancel scheduled posts')
    })
  })

  describe('updatePost on cancelled post', () => {
    it('should reject updating a cancelled post', () => {
      const postId = aggregate.schedulePost({
        content: 'Will be cancelled',
        scheduledFor: futureDate(),
        userId,
      })
      aggregate.cancelPost({ postId, reason: 'Test' })

      expect(() =>
        aggregate.updatePost({
          postId,
          content: 'Updated',
          scheduledFor: futureDate(),
        })
      ).toThrow('Can only update scheduled posts')
    })
  })

  describe('getPosts', () => {
    it('should return all posts', () => {
      // Use loadFromHistory to create multiple posts with different IDs
      const events = [
        {
          id: 'evt-1',
          streamId: orgId,
          streamType: 'post-timeline',
          eventType: POST_EVENT_TYPES.POST_SCHEDULED,
          eventVersion: 1,
          payload: {
            postId: 'post-1',
            content: 'Post 1',
            mediaUrls: [],
            scheduledFor: futureDate().toISOString(),
            createdBy: userId,
          },
          metadata: { userId, timestamp: new Date().toISOString() },
          sequence: 1,
          streamSequence: 1,
          createdAt: new Date(),
        },
        {
          id: 'evt-2',
          streamId: orgId,
          streamType: 'post-timeline',
          eventType: POST_EVENT_TYPES.POST_SCHEDULED,
          eventVersion: 1,
          payload: {
            postId: 'post-2',
            content: 'Post 2',
            mediaUrls: [],
            scheduledFor: futureDate().toISOString(),
            createdBy: userId,
          },
          metadata: { userId, timestamp: new Date().toISOString() },
          sequence: 2,
          streamSequence: 2,
          createdAt: new Date(),
        },
      ]

      const agg = new PostTimelineAggregate(orgId)
      agg.loadFromHistory(events as any)

      const posts = agg.getPosts()
      expect(posts).toHaveLength(2)
      expect(posts.map(p => p.content)).toContain('Post 1')
      expect(posts.map(p => p.content)).toContain('Post 2')
    })
  })

  describe('event replay', () => {
    it('should rebuild state from events', () => {
      const scheduledFor = futureDate()

      // Create events to replay
      const events = [
        {
          id: 'evt-1',
          streamId: orgId,
          streamType: 'post-timeline',
          eventType: POST_EVENT_TYPES.POST_SCHEDULED,
          eventVersion: 1,
          payload: {
            postId: 'post-1',
            content: 'Original',
            mediaUrls: [],
            scheduledFor: scheduledFor.toISOString(),
            createdBy: userId,
          },
          metadata: { userId, timestamp: new Date().toISOString() },
          sequence: 1,
          streamSequence: 1,
          createdAt: new Date(),
        },
        {
          id: 'evt-2',
          streamId: orgId,
          streamType: 'post-timeline',
          eventType: POST_EVENT_TYPES.POST_UPDATED,
          eventVersion: 1,
          payload: {
            postId: 'post-1',
            content: 'Updated',
            scheduledFor: scheduledFor.toISOString(),
          },
          metadata: { userId, timestamp: new Date().toISOString() },
          sequence: 2,
          streamSequence: 2,
          createdAt: new Date(),
        },
      ]

      const newAggregate = new PostTimelineAggregate(orgId)
      newAggregate.loadFromHistory(events as any)

      const post = newAggregate.getPost('post-1')
      expect(post?.content).toBe('Updated')
      expect(newAggregate.version).toBe(2)
    })
  })
})
