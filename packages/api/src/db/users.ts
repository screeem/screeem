/**
 * Type-safe user database queries
 */

import type { Pool, PoolClient } from 'pg'
import type { User } from './types.js'

export async function getUserById(
  client: Pool | PoolClient,
  id: string
): Promise<User | null> {
  const result = await client.query<User>(
    `SELECT * FROM users WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

export async function getUserByEmail(
  client: Pool | PoolClient,
  email: string
): Promise<User | null> {
  const result = await client.query<User>(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  )
  return result.rows[0] || null
}

export interface CreateUserParams {
  id: string // From Supabase auth.users.id
  email: string
  displayName?: string | null
  avatarUrl?: string | null
}

export async function createUser(
  client: Pool | PoolClient,
  params: CreateUserParams
): Promise<User> {
  const result = await client.query<User>(
    `INSERT INTO users (id, email, display_name, avatar_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.id, params.email, params.displayName, params.avatarUrl]
  )
  return result.rows[0]
}

export interface UpdateUserParams {
  displayName?: string | null
  avatarUrl?: string | null
}

export async function updateUser(
  client: Pool | PoolClient,
  id: string,
  params: UpdateUserParams
): Promise<User> {
  const result = await client.query<User>(
    `UPDATE users
     SET display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, params.displayName, params.avatarUrl]
  )
  return result.rows[0]
}

export async function deleteUser(
  client: Pool | PoolClient,
  id: string
): Promise<void> {
  await client.query(`DELETE FROM users WHERE id = $1`, [id])
}

// Upsert user (insert or update if exists)
export async function upsertUser(
  client: Pool | PoolClient,
  params: CreateUserParams
): Promise<User> {
  const result = await client.query<User>(
    `INSERT INTO users (id, email, display_name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id)
     DO UPDATE SET
       email = EXCLUDED.email,
       display_name = COALESCE(EXCLUDED.display_name, users.display_name),
       avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
       updated_at = NOW()
     RETURNING *`,
    [params.id, params.email, params.displayName, params.avatarUrl]
  )
  return result.rows[0]
}
