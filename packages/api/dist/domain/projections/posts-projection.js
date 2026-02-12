/**
 * Posts Projection - Updates scheduled_posts read model from events
 */
import { Projection } from '@screeem/event-sourcing';
import { POST_EVENT_TYPES, } from '@screeem/shared';
import { pool } from '../../config/database.js';
export class PostsProjection extends Projection {
    constructor() {
        super();
        // Register event handlers
        this.registerHandler(POST_EVENT_TYPES.POST_SCHEDULED, this.handlePostScheduled.bind(this));
        this.registerHandler(POST_EVENT_TYPES.POST_UPDATED, this.handlePostUpdated.bind(this));
        this.registerHandler(POST_EVENT_TYPES.POST_CANCELLED, this.handlePostCancelled.bind(this));
    }
    /**
     * Handle PostScheduled event - Insert into scheduled_posts
     */
    async handlePostScheduled(event) {
        const payload = event.payload;
        await pool.query(`INSERT INTO scheduled_posts (
        id, organization_id, created_by, content, media_urls,
        scheduled_for, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING`, [
            payload.postId,
            event.streamId,
            payload.createdBy,
            payload.content,
            JSON.stringify(payload.mediaUrls),
            payload.scheduledFor,
            'scheduled',
            event.createdAt,
        ]);
    }
    /**
     * Handle PostUpdated event - Update scheduled_posts
     */
    async handlePostUpdated(event) {
        const payload = event.payload;
        await pool.query(`UPDATE scheduled_posts
       SET content = $2,
           scheduled_for = $3,
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1`, [payload.postId, payload.content, payload.scheduledFor]);
    }
    /**
     * Handle PostCancelled event - Update status to cancelled
     */
    async handlePostCancelled(event) {
        const payload = event.payload;
        await pool.query(`UPDATE scheduled_posts
       SET status = 'cancelled',
           updated_at = NOW(),
           version = version + 1
       WHERE id = $1`, [payload.postId]);
    }
    /**
     * Clear all projected data (for rebuild)
     */
    async clear() {
        await pool.query(`TRUNCATE TABLE scheduled_posts`);
    }
    /**
     * Start listening to events and projecting them
     */
    async start() {
        // Subscribe to event store notifications
        await eventStore.subscribe(async (event) => {
            // Only handle post timeline events
            if (event.streamType === 'post-timeline') {
                await this.handle(event);
            }
        });
    }
}
// Export singleton instance
import { eventStore } from '../../infrastructure/event-store/index.js';
export const postsProjection = new PostsProjection();
