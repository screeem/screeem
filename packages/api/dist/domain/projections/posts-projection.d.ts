/**
 * Posts Projection - Updates scheduled_posts read model from events
 */
import { Projection } from '@screeem/event-sourcing';
export declare class PostsProjection extends Projection {
    constructor();
    /**
     * Handle PostScheduled event - Insert into scheduled_posts
     */
    private handlePostScheduled;
    /**
     * Handle PostUpdated event - Update scheduled_posts
     */
    private handlePostUpdated;
    /**
     * Handle PostCancelled event - Update status to cancelled
     */
    private handlePostCancelled;
    /**
     * Clear all projected data (for rebuild)
     */
    protected clear(): Promise<void>;
    /**
     * Start listening to events and projecting them
     */
    start(): Promise<void>;
}
export declare const postsProjection: PostsProjection;
//# sourceMappingURL=posts-projection.d.ts.map