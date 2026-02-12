/**
 * Post Timeline Aggregate - Event-sourced post scheduling
 *
 * Manages the timeline of scheduled posts for an organization.
 * Each organization has one post timeline (stream_id = organization_id)
 */
import { Aggregate } from '@screeem/event-sourcing';
interface Post {
    id: string;
    content: string;
    mediaUrls: string[];
    scheduledFor: Date;
    status: 'scheduled' | 'cancelled' | 'published' | 'failed';
    createdBy: string;
}
export declare class PostTimelineAggregate extends Aggregate {
    private posts;
    constructor(organizationId: string);
    /**
     * Schedule a new post
     */
    schedulePost(params: {
        content: string;
        scheduledFor: Date;
        mediaUrls?: string[];
        userId: string;
    }): string;
    /**
     * Update a scheduled post
     */
    updatePost(params: {
        postId: string;
        content: string;
        scheduledFor: Date;
    }): void;
    /**
     * Cancel a scheduled post
     */
    cancelPost(params: {
        postId: string;
        reason: string;
    }): void;
    /**
     * Get all posts in the timeline
     */
    getPosts(): Post[];
    /**
     * Get a specific post
     */
    getPost(postId: string): Post | undefined;
    private onPostScheduled;
    private onPostUpdated;
    private onPostCancelled;
}
export {};
//# sourceMappingURL=post-timeline.d.ts.map