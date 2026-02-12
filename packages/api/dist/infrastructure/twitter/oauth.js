import { TwitterApi } from 'twitter-api-v2';
import { env } from '../../config/env.js';
import { encrypt } from '../encryption.js';
/**
 * Generate OAuth 2.0 authorization URL
 */
export async function generateAuthUrl(state) {
    if (!env.TWITTER_CLIENT_ID || !env.TWITTER_CALLBACK_URL) {
        throw new Error('Twitter OAuth not configured');
    }
    const client = new TwitterApi({
        clientId: env.TWITTER_CLIENT_ID,
    });
    // Generate PKCE challenge
    const { url, codeVerifier } = client.generateOAuth2AuthLink(env.TWITTER_CALLBACK_URL, {
        scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    });
    // Store code verifier in state (we'll need it for the callback)
    const stateData = {
        ...state,
        codeVerifier,
    };
    // Encode state as base64
    const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64url');
    // Replace the random state with our encoded state
    const urlWithState = url.replace(/state=[^&]+/, `state=${encodedState}`);
    return urlWithState;
}
/**
 * Handle OAuth 2.0 callback and exchange code for tokens
 */
export async function handleCallback(code, encodedState) {
    if (!env.TWITTER_CLIENT_ID || !env.TWITTER_CLIENT_SECRET) {
        throw new Error('Twitter OAuth not configured');
    }
    // Decode state
    const stateData = JSON.parse(Buffer.from(encodedState, 'base64url').toString('utf-8'));
    const client = new TwitterApi({
        clientId: env.TWITTER_CLIENT_ID,
        clientSecret: env.TWITTER_CLIENT_SECRET,
    });
    try {
        // Exchange code for tokens using PKCE
        const { client: userClient, accessToken, refreshToken, expiresIn, } = await client.loginWithOAuth2({
            code,
            codeVerifier: stateData.codeVerifier,
            redirectUri: env.TWITTER_CALLBACK_URL,
        });
        // Get user profile
        const me = await userClient.v2.me({
            'user.fields': ['id', 'name', 'username'],
        });
        // Calculate token expiry
        const expiresAt = expiresIn
            ? new Date(Date.now() + expiresIn * 1000)
            : undefined;
        // Encrypt tokens before storing
        const encryptedAccessToken = encrypt(accessToken);
        const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : undefined;
        return {
            tokens: {
                accessToken: encryptedAccessToken,
                refreshToken: encryptedRefreshToken,
                expiresAt,
            },
            state: stateData,
            profile: {
                id: me.data.id,
                name: me.data.name,
                username: me.data.username,
            },
        };
    }
    catch (error) {
        throw new Error(`OAuth callback failed: ${error.message}`);
    }
}
/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(encryptedRefreshToken) {
    if (!env.TWITTER_CLIENT_ID || !env.TWITTER_CLIENT_SECRET) {
        throw new Error('Twitter OAuth not configured');
    }
    const client = new TwitterApi({
        clientId: env.TWITTER_CLIENT_ID,
        clientSecret: env.TWITTER_CLIENT_SECRET,
    });
    try {
        // Decrypt refresh token
        const { decrypt } = await import('../encryption.js');
        const refreshToken = decrypt(encryptedRefreshToken);
        // Refresh the token
        const { accessToken, refreshToken: newRefreshToken, expiresIn, } = await client.refreshOAuth2Token(refreshToken);
        // Calculate token expiry
        const expiresAt = expiresIn
            ? new Date(Date.now() + expiresIn * 1000)
            : undefined;
        // Encrypt new tokens
        const encryptedAccessToken = encrypt(accessToken);
        const encryptedNewRefreshToken = newRefreshToken
            ? encrypt(newRefreshToken)
            : encryptedRefreshToken;
        return {
            accessToken: encryptedAccessToken,
            refreshToken: encryptedNewRefreshToken,
            expiresAt,
        };
    }
    catch (error) {
        throw new Error(`Token refresh failed: ${error.message}`);
    }
}
