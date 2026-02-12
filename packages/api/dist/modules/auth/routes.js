/**
 * Authentication routes
 */
import { pool } from '../../config/database.js';
import { getUserById, upsertUser } from '../../db/users.js';
export async function registerAuthRoutes(fastify) {
    // Get current user (requires authentication)
    fastify.get('/api/auth/me', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const supabaseUser = request.supabaseUser;
        // Sync user to local database if not exists
        const user = await upsertUser(pool, {
            id: supabaseUser.id,
            email: supabaseUser.email,
            displayName: null,
            avatarUrl: null,
        });
        return reply.send({
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            avatarUrl: user.avatar_url,
        });
    });
    // Update current user profile
    fastify.patch('/api/auth/me', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const supabaseUser = request.supabaseUser;
        const body = request.body;
        // Get existing user
        let user = await getUserById(pool, supabaseUser.id);
        // If user doesn't exist locally, create them
        if (!user) {
            user = await upsertUser(pool, {
                id: supabaseUser.id,
                email: supabaseUser.email,
                displayName: body.displayName || null,
                avatarUrl: body.avatarUrl || null,
            });
        }
        else {
            // Update user
            const updated = await pool.query(`UPDATE users
           SET display_name = COALESCE($2, display_name),
               avatar_url = COALESCE($3, avatar_url),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`, [user.id, body.displayName, body.avatarUrl]);
            user = updated.rows[0];
        }
        if (!user) {
            return reply.status(500).send({ error: 'Failed to update user' });
        }
        return reply.send({
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            avatarUrl: user.avatar_url,
        });
    });
}
