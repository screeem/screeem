import { TwitterApi, EUploadMimeType } from 'twitter-api-v2';
import { decrypt } from '../encryption.js';
export class TwitterClient {
    client;
    constructor(credentials) {
        // Decrypt the access token before using
        const accessToken = decrypt(credentials.accessToken);
        this.client = new TwitterApi(accessToken);
    }
    /**
     * Post a tweet with optional media
     */
    async postTweet(text, mediaUrls) {
        try {
            let mediaIds = [];
            // Upload media if provided
            if (mediaUrls && mediaUrls.length > 0) {
                mediaIds = await this.uploadMedia(mediaUrls);
            }
            // Post tweet
            const tweetPayload = { text };
            // Twitter API expects media_ids as tuple with max 4 items
            if (mediaIds.length > 0) {
                tweetPayload.media = {
                    media_ids: mediaIds.slice(0, 4), // Max 4 media items
                };
            }
            const tweet = await this.client.v2.tweet(tweetPayload);
            return {
                tweetId: tweet.data.id,
                text: tweet.data.text,
                createdAt: new Date().toISOString(),
            };
        }
        catch (error) {
            throw new Error(`Failed to post tweet: ${error.message}`);
        }
    }
    /**
     * Upload media files to Twitter
     */
    async uploadMedia(mediaUrls) {
        const mediaIds = [];
        for (const url of mediaUrls) {
            try {
                // Fetch the media file
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch media from ${url}`);
                }
                const buffer = Buffer.from(await response.arrayBuffer());
                const contentType = response.headers.get('content-type') || 'image/jpeg';
                // Determine MIME type
                let mimeType;
                if (contentType.includes('png')) {
                    mimeType = EUploadMimeType.Png;
                }
                else if (contentType.includes('gif')) {
                    mimeType = EUploadMimeType.Gif;
                }
                else if (contentType.includes('webp')) {
                    mimeType = EUploadMimeType.Webp;
                }
                else {
                    mimeType = EUploadMimeType.Jpeg;
                }
                // Upload to Twitter
                const mediaId = await this.client.v1.uploadMedia(buffer, { mimeType });
                mediaIds.push(mediaId);
            }
            catch (error) {
                console.error(`Failed to upload media from ${url}:`, error);
                // Continue with other media, don't fail the whole tweet
            }
        }
        return mediaIds;
    }
    /**
     * Get the authenticated user's profile
     */
    async getProfile() {
        try {
            const user = await this.client.v2.me({
                'user.fields': ['id', 'name', 'username', 'profile_image_url'],
            });
            return {
                id: user.data.id,
                name: user.data.name,
                username: user.data.username,
                profileImageUrl: user.data.profile_image_url,
            };
        }
        catch (error) {
            throw new Error(`Failed to get user profile: ${error.message}`);
        }
    }
    /**
     * Verify credentials are still valid
     */
    async verifyCredentials() {
        try {
            await this.client.v2.me();
            return true;
        }
        catch (error) {
            return false;
        }
    }
}
/**
 * Create a TwitterClient from encrypted credentials
 */
export function createTwitterClient(encryptedAccessToken, encryptedRefreshToken) {
    return new TwitterClient({
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
    });
}
