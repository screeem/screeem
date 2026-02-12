/**
 * Post Publisher - Background job that publishes scheduled posts to Twitter
 */
export declare class PostPublisher {
    private interval;
    private isProcessing;
    /**
     * Start the publisher background job
     */
    start(intervalMs?: number): void;
    /**
     * Stop the publisher background job
     */
    stop(): void;
    /**
     * Process all posts that are due to be published
     */
    private processScheduledPosts;
    /**
     * Publish a single post to Twitter
     */
    private publishPost;
}
export declare const postPublisher: PostPublisher;
//# sourceMappingURL=publisher.d.ts.map