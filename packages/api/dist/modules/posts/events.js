/**
 * Post events streaming via Server-Sent Events (SSE)
 */
import { eventStore } from '../../infrastructure/event-store/index.js';
import { checkUserOrgAccess } from '../../db/organizations.js';
import { pool } from '../../config/database.js';
export async function registerEventRoutes(fastify) {
    /**
     * SSE endpoint for real-time post events
     * GET /api/organizations/:id/posts/events
     */
    fastify.get('/api/organizations/:id/posts/events', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { id: organizationId } = request.params;
        const userId = request.supabaseUser.id;
        // Check access
        const hasAccess = await checkUserOrgAccess(pool, organizationId, userId);
        if (!hasAccess) {
            return reply.status(403).send({ error: 'Access denied' });
        }
        // Set up SSE headers
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*', // Will be restricted by CORS plugin
        });
        // Send initial comment to establish connection
        reply.raw.write(': connected\n\n');
        // Subscribe to event store
        const unsubscribe = await eventStore.subscribe((event) => {
            // Only send events for this organization's post timeline
            if (event.streamId === organizationId && event.streamType === 'post-timeline') {
                const data = JSON.stringify({
                    id: event.id,
                    type: event.eventType,
                    payload: event.payload,
                    metadata: event.metadata,
                    sequence: event.streamSequence,
                    timestamp: event.createdAt.toISOString(),
                });
                // Send event in SSE format
                reply.raw.write(`id: ${event.id}\n`);
                reply.raw.write(`event: ${event.eventType}\n`);
                reply.raw.write(`data: ${data}\n\n`);
            }
        });
        // Handle client disconnect
        request.raw.on('close', () => {
            unsubscribe();
            reply.raw.end();
        });
    });
    /**
     * Get event history with pagination
     * GET /api/organizations/:id/posts/events/history
     */
    fastify.get('/api/organizations/:id/posts/events/history', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { id: organizationId } = request.params;
        const userId = request.supabaseUser.id;
        const { page = 1, pageSize = 50 } = request.query;
        // Check access
        const hasAccess = await checkUserOrgAccess(pool, organizationId, userId);
        if (!hasAccess) {
            return reply.status(403).send({ error: 'Access denied' });
        }
        // Validate pagination params
        const validatedPage = Math.max(1, Number(page));
        const validatedPageSize = Math.min(100, Math.max(1, Number(pageSize)));
        // Get event history
        const { events, total } = await eventStore.getEventHistory(organizationId, {
            page: validatedPage,
            pageSize: validatedPageSize,
        });
        return reply.send({
            events: events.map((event) => ({
                id: event.id,
                eventType: event.eventType,
                payload: event.payload,
                metadata: event.metadata,
                sequence: event.streamSequence,
                createdAt: event.createdAt.toISOString(),
            })),
            pagination: {
                total,
                page: validatedPage,
                pageSize: validatedPageSize,
                totalPages: Math.ceil(total / validatedPageSize),
            },
        });
    });
}
