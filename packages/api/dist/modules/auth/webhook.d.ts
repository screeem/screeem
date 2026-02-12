/**
 * Supabase webhook handler for user sync
 *
 * Handles auth.users changes from Supabase webhooks:
 * - user.created: Create local user record
 * - user.updated: Update local user record
 * - user.deleted: Delete local user record
 */
import type { FastifyInstance } from 'fastify';
export declare function registerWebhookRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=webhook.d.ts.map