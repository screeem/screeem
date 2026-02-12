/**
 * Post Timeline Aggregate - Event-sourced post scheduling
 *
 * Manages the timeline of scheduled posts for an organization.
 * Each organization has one post timeline (stream_id = organization_id)
 */
import { Aggregate } from '@screeem/event-sourcing';
import { POST_EVENT_TYPES, } from '@screeem/shared';
import { randomUUID } from 'crypto';
export class PostTimelineAggregate extends Aggregate {
    posts = new Map();
    constructor(organizationId) {
        super(organizationId); // stream_id is the organization ID
        // Register event handlers
        this.registerHandler(POST_EVENT_TYPES.POST_SCHEDULED, this.onPostScheduled.bind(this));
        this.registerHandler(POST_EVENT_TYPES.POST_UPDATED, this.onPostUpdated.bind(this));
        this.registerHandler(POST_EVENT_TYPES.POST_CANCELLED, this.onPostCancelled.bind(this));
    }
    /**
     * Schedule a new post
     */
    schedulePost(params) {
        // Validation
        if (!params.content || params.content.trim().length === 0) {
            throw new Error('Post content cannot be empty');
        }
        if (params.content.length > 280) {
            throw new Error('Post content cannot exceed 280 characters');
        }
        if (params.scheduledFor <= new Date()) {
            throw new Error('Scheduled time must be in the future');
        }
        if (params.mediaUrls && params.mediaUrls.length > 4) {
            throw new Error('Cannot attach more than 4 media items');
        }
        // Generate post ID
        const postId = randomUUID();
        // Raise event
        const payload = {
            postId,
            content: params.content.trim(),
            mediaUrls: params.mediaUrls || [],
            scheduledFor: params.scheduledFor.toISOString(),
            createdBy: params.userId,
        };
        this.raiseEvent(POST_EVENT_TYPES.POST_SCHEDULED, payload);
        return postId;
    }
    /**
     * Update a scheduled post
     */
    updatePost(params) {
        const post = this.posts.get(params.postId);
        if (!post) {
            throw new Error('Post not found');
        }
        if (post.status !== 'scheduled') {
            throw new Error('Can only update scheduled posts');
        }
        // Validation
        if (!params.content || params.content.trim().length === 0) {
            throw new Error('Post content cannot be empty');
        }
        if (params.content.length > 280) {
            throw new Error('Post content cannot exceed 280 characters');
        }
        // Raise event
        const payload = {
            postId: params.postId,
            content: params.content.trim(),
            scheduledFor: params.scheduledFor.toISOString(),
        };
        this.raiseEvent(POST_EVENT_TYPES.POST_UPDATED, payload);
    }
    /**
     * Cancel a scheduled post
     */
    cancelPost(params) {
        const post = this.posts.get(params.postId);
        if (!post) {
            throw new Error('Post not found');
        }
        if (post.status !== 'scheduled') {
            throw new Error('Can only cancel scheduled posts');
        }
        // Raise event
        const payload = {
            postId: params.postId,
            reason: params.reason,
        };
        this.raiseEvent(POST_EVENT_TYPES.POST_CANCELLED, payload);
    }
    /**
     * Get all posts in the timeline
     */
    getPosts() {
        return Array.from(this.posts.values());
    }
    /**
     * Get a specific post
     */
    getPost(postId) {
        return this.posts.get(postId);
    }
    // Event handlers
    onPostScheduled(payload) {
        this.posts.set(payload.postId, {
            id: payload.postId,
            content: payload.content,
            mediaUrls: payload.mediaUrls,
            scheduledFor: new Date(payload.scheduledFor),
            status: 'scheduled',
            createdBy: payload.createdBy,
        });
    }
    onPostUpdated(payload) {
        const post = this.posts.get(payload.postId);
        if (post) {
            post.content = payload.content;
            post.scheduledFor = new Date(payload.scheduledFor);
        }
    }
    onPostCancelled(payload) {
        const post = this.posts.get(payload.postId);
        if (post) {
            post.status = 'cancelled';
        }
    }
}
