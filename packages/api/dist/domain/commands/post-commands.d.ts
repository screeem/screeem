/**
 * Post command handlers
 *
 * Handle post scheduling commands using event sourcing
 */
/**
 * Handle SchedulePost command
 */
export declare function handleSchedulePost(params: {
    organizationId: string;
    userId: string;
    content: string;
    scheduledFor: Date;
    mediaUrls?: string[];
}): Promise<{
    postId: string;
    eventId: string;
}>;
/**
 * Handle UpdatePost command
 */
export declare function handleUpdatePost(params: {
    organizationId: string;
    userId: string;
    postId: string;
    content: string;
    scheduledFor: Date;
}): Promise<{
    eventId: string;
}>;
/**
 * Handle CancelPost command
 */
export declare function handleCancelPost(params: {
    organizationId: string;
    userId: string;
    postId: string;
    reason: string;
}): Promise<{
    eventId: string;
}>;
//# sourceMappingURL=post-commands.d.ts.map