export interface TwitterOAuthState {
    organizationId: string;
    userId: string;
    codeVerifier: string;
}
export interface TwitterTokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
}
/**
 * Generate OAuth 2.0 authorization URL
 */
export declare function generateAuthUrl(state: TwitterOAuthState): Promise<string>;
/**
 * Handle OAuth 2.0 callback and exchange code for tokens
 */
export declare function handleCallback(code: string, encodedState: string): Promise<{
    tokens: TwitterTokens;
    state: TwitterOAuthState;
    profile: {
        id: string;
        name: string;
        username: string;
    };
}>;
/**
 * Refresh an expired access token
 */
export declare function refreshAccessToken(encryptedRefreshToken: string): Promise<TwitterTokens>;
//# sourceMappingURL=oauth.d.ts.map