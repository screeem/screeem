export interface TwitterCredentials {
    accessToken: string;
    refreshToken?: string;
}
export interface TweetResult {
    tweetId: string;
    text: string;
    createdAt: string;
}
export declare class TwitterClient {
    private client;
    constructor(credentials: TwitterCredentials);
    /**
     * Post a tweet with optional media
     */
    postTweet(text: string, mediaUrls?: string[]): Promise<TweetResult>;
    /**
     * Upload media files to Twitter
     */
    private uploadMedia;
    /**
     * Get the authenticated user's profile
     */
    getProfile(): Promise<{
        id: string;
        name: string;
        username: string;
        profileImageUrl: string | undefined;
    }>;
    /**
     * Verify credentials are still valid
     */
    verifyCredentials(): Promise<boolean>;
}
/**
 * Create a TwitterClient from encrypted credentials
 */
export declare function createTwitterClient(encryptedAccessToken: string, encryptedRefreshToken?: string): TwitterClient;
//# sourceMappingURL=client.d.ts.map