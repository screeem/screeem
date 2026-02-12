/**
 * Post Publisher - Background job that publishes scheduled posts to Twitter
 */

import { pool } from '../../config/database.js'
import { eventStore } from '../event-store/index.js'
import { getTwitterAccountByOrg } from '../../db/twitter.js'
import { createTwitterClient } from './client.js'
import { POST_EVENT_TYPES } from '@screeem/shared/types/events'
import type { PostPublishedPayload, PostFailedPayload } from '@screeem/shared/types/events'

export class PostPublisher {
  private interval: NodeJS.Timeout | null = null
  private isProcessing = false

  /**
   * Start the publisher background job
   */
  start(intervalMs: number = 60000) {
    console.log(`📤 Post publisher starting (checks every ${intervalMs}ms)`)

    // Run immediately on start
    this.processScheduledPosts().catch((error) => {
      console.error('Failed to process scheduled posts:', error)
    })

    // Then run at interval
    this.interval = setInterval(() => {
      this.processScheduledPosts().catch((error) => {
        console.error('Failed to process scheduled posts:', error)
      })
    }, intervalMs)
  }

  /**
   * Stop the publisher background job
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      console.log('📤 Post publisher stopped')
    }
  }

  /**
   * Process all posts that are due to be published
   */
  private async processScheduledPosts() {
    if (this.isProcessing) {
      console.log('Already processing posts, skipping this cycle')
      return
    }

    this.isProcessing = true

    try {
      // Find all posts that are scheduled for the past and still in 'scheduled' status
      const result = await pool.query(
        `SELECT id, organization_id, content, media_urls, scheduled_for
         FROM scheduled_posts
         WHERE status = 'scheduled'
           AND scheduled_for <= NOW()
         ORDER BY scheduled_for ASC
         LIMIT 10`
      )

      const posts = result.rows

      if (posts.length === 0) {
        return
      }

      console.log(`📤 Found ${posts.length} posts to publish`)

      // Process each post
      for (const post of posts) {
        try {
          await this.publishPost(post)
        } catch (error) {
          console.error(`Failed to publish post ${post.id}:`, error)
          // Continue with next post
        }
      }
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Publish a single post to Twitter
   */
  private async publishPost(post: any) {
    const { id: postId, organization_id: organizationId, content, media_urls: mediaUrls } = post

    console.log(`📤 Publishing post ${postId} for org ${organizationId}`)

    try {
      // Emit PostPublishing event
      await eventStore.append(
        organizationId,
        'post-timeline',
        [
          {
            type: POST_EVENT_TYPES.POST_PUBLISHING,
            payload: { postId },
          },
        ],
        -1, // Don't check version for publishing events
        {
          userId: 'system',
          timestamp: new Date().toISOString(),
        }
      )

      // Get Twitter account for this organization
      const twitterAccount = await getTwitterAccountByOrg(pool, organizationId)

      if (!twitterAccount) {
        throw new Error('No Twitter account connected')
      }

      // Create Twitter client
      const twitterClient = createTwitterClient(
        twitterAccount.accessToken,
        twitterAccount.refreshToken || undefined
      )

      // Post to Twitter
      const result = await twitterClient.postTweet(content, mediaUrls || [])

      console.log(`✅ Posted to Twitter: ${result.tweetId}`)

      // Emit PostPublished event
      const payload: PostPublishedPayload = {
        postId,
        tweetId: result.tweetId,
        publishedAt: result.createdAt,
      }

      await eventStore.append(
        organizationId,
        'post-timeline',
        [
          {
            type: POST_EVENT_TYPES.POST_PUBLISHED,
            payload,
          },
        ],
        -1,
        {
          userId: 'system',
          timestamp: new Date().toISOString(),
        }
      )
    } catch (error: any) {
      console.error(`❌ Failed to publish post ${postId}:`, error.message)

      // Emit PostFailed event
      const payload: PostFailedPayload = {
        postId,
        error: error.message,
      }

      await eventStore.append(
        organizationId,
        'post-timeline',
        [
          {
            type: POST_EVENT_TYPES.POST_FAILED,
            payload,
          },
        ],
        -1,
        {
          userId: 'system',
          timestamp: new Date().toISOString(),
        }
      )
    }
  }
}

// Singleton instance
export const postPublisher = new PostPublisher()
