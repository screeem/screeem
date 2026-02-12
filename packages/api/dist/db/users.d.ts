/**
 * Type-safe user database queries
 */
import type { Pool, PoolClient } from 'pg';
import type { User } from './types.js';
export declare function getUserById(client: Pool | PoolClient, id: string): Promise<User | null>;
export declare function getUserByEmail(client: Pool | PoolClient, email: string): Promise<User | null>;
export interface CreateUserParams {
    id: string;
    email: string;
    displayName?: string | null;
    avatarUrl?: string | null;
}
export declare function createUser(client: Pool | PoolClient, params: CreateUserParams): Promise<User>;
export interface UpdateUserParams {
    displayName?: string | null;
    avatarUrl?: string | null;
}
export declare function updateUser(client: Pool | PoolClient, id: string, params: UpdateUserParams): Promise<User>;
export declare function deleteUser(client: Pool | PoolClient, id: string): Promise<void>;
export declare function upsertUser(client: Pool | PoolClient, params: CreateUserParams): Promise<User>;
//# sourceMappingURL=users.d.ts.map