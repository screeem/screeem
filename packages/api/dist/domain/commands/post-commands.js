/**
 * Post command handlers
 *
 * Handle post scheduling commands using event sourcing
 */
import { eventStore } from '../../infrastructure/event-store/index.js';
import { PostTimelineAggregate } from '../aggregates/post-timeline.js';
import { STREAM_TYPES } from '@screeem/shared';
/**
 * Handle SchedulePost command
 */
export async function handleSchedulePost(params) {
    // Load aggregate from event store
    const aggregate = new PostTimelineAggregate(params.organizationId);
    const events = await eventStore.getStream(params.organizationId);
    aggregate.loadFromHistory(events);
    // Execute command on aggregate
    const postId = aggregate.schedulePost({
        content: params.content,
        scheduledFor: params.scheduledFor,
        mediaUrls: params.mediaUrls,
        userId: params.userId,
    });
    // Get uncommitted events
    const uncommittedEvents = aggregate.getUncommittedEvents();
    // Persist events with optimistic concurrency control
    const persistedEvents = await eventStore.append(params.organizationId, STREAM_TYPES.POST_TIMELINE, uncommittedEvents, aggregate.version - uncommittedEvents.length, // expected version before new events
    {
        userId: params.userId,
        timestamp: new Date().toISOString(),
    });
    // Mark events as committed
    aggregate.markEventsAsCommitted();
    return {
        postId,
        eventId: persistedEvents[0].id,
    };
}
/**
 * Handle UpdatePost command
 */
export async function handleUpdatePost(params) {
    // Load aggregate
    const aggregate = new PostTimelineAggregate(params.organizationId);
    const events = await eventStore.getStream(params.organizationId);
    aggregate.loadFromHistory(events);
    // Execute command
    aggregate.updatePost({
        postId: params.postId,
        content: params.content,
        scheduledFor: params.scheduledFor,
    });
    // Persist events
    const uncommittedEvents = aggregate.getUncommittedEvents();
    const persistedEvents = await eventStore.append(params.organizationId, STREAM_TYPES.POST_TIMELINE, uncommittedEvents, aggregate.version - uncommittedEvents.length, {
        userId: params.userId,
        timestamp: new Date().toISOString(),
    });
    aggregate.markEventsAsCommitted();
    return {
        eventId: persistedEvents[0].id,
    };
}
/**
 * Handle CancelPost command
 */
export async function handleCancelPost(params) {
    // Load aggregate
    const aggregate = new PostTimelineAggregate(params.organizationId);
    const events = await eventStore.getStream(params.organizationId);
    aggregate.loadFromHistory(events);
    // Execute command
    aggregate.cancelPost({
        postId: params.postId,
        reason: params.reason,
    });
    // Persist events
    const uncommittedEvents = aggregate.getUncommittedEvents();
    const persistedEvents = await eventStore.append(params.organizationId, STREAM_TYPES.POST_TIMELINE, uncommittedEvents, aggregate.version - uncommittedEvents.length, {
        userId: params.userId,
        timestamp: new Date().toISOString(),
    });
    aggregate.markEventsAsCommitted();
    return {
        eventId: persistedEvents[0].id,
    };
}
