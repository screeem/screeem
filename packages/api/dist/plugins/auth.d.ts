/**
 * Supabase JWT authentication plugin for Fastify
 */
import type { FastifyInstance } from 'fastify';
declare module 'fastify' {
    interface FastifyRequest {
        supabaseUser?: {
            id: string;
            email: string;
            role?: string;
        };
    }
    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}
declare function authPlugin(fastify: FastifyInstance): Promise<void>;
declare const _default: typeof authPlugin;
export default _default;
//# sourceMappingURL=auth.d.ts.map