/**
 * Type-safe user database queries
 */
export async function getUserById(client, id) {
    const result = await client.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return result.rows[0] || null;
}
export async function getUserByEmail(client, email) {
    const result = await client.query(`SELECT * FROM users WHERE email = $1`, [email]);
    return result.rows[0] || null;
}
export async function createUser(client, params) {
    const result = await client.query(`INSERT INTO users (id, email, display_name, avatar_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`, [params.id, params.email, params.displayName, params.avatarUrl]);
    return result.rows[0];
}
export async function updateUser(client, id, params) {
    const result = await client.query(`UPDATE users
     SET display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`, [id, params.displayName, params.avatarUrl]);
    return result.rows[0];
}
export async function deleteUser(client, id) {
    await client.query(`DELETE FROM users WHERE id = $1`, [id]);
}
// Upsert user (insert or update if exists)
export async function upsertUser(client, params) {
    const result = await client.query(`INSERT INTO users (id, email, display_name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id)
     DO UPDATE SET
       email = EXCLUDED.email,
       display_name = COALESCE(EXCLUDED.display_name, users.display_name),
       avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
       updated_at = NOW()
     RETURNING *`, [params.id, params.email, params.displayName, params.avatarUrl]);
    return result.rows[0];
}
