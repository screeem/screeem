import type { Pool, PoolClient } from 'pg';
export interface TwitterAccount {
    id: string;
    organizationId: string;
    accountName: string;
    accountId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
    connectedBy: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface CreateTwitterAccountParams {
    organizationId: string;
    accountName: string;
    accountId: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    connectedBy: string;
}
export declare function getTwitterAccountByOrg(client: Pool | PoolClient, organizationId: string): Promise<TwitterAccount | null>;
export declare function getTwitterAccountById(client: Pool | PoolClient, id: string): Promise<TwitterAccount | null>;
export declare function createTwitterAccount(client: Pool | PoolClient, params: CreateTwitterAccountParams): Promise<TwitterAccount>;
export declare function updateTwitterTokens(client: Pool | PoolClient, organizationId: string, accessToken: string, refreshToken?: string, expiresAt?: Date): Promise<void>;
export declare function deleteTwitterAccount(client: Pool | PoolClient, organizationId: string): Promise<void>;
//# sourceMappingURL=twitter.d.ts.map