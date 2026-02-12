/**
 * Type-safe event store database queries
 */
import type { Pool, PoolClient } from 'pg';
import type { Event } from './types.js';
export interface AppendEventParams {
    id: string;
    streamId: string;
    streamType: string;
    eventType: string;
    eventVersion: number;
    payload: unknown;
    metadata: unknown;
    streamSequence: number;
    createdAt: Date;
}
export declare function getEventsByStream(client: Pool | PoolClient, streamId: string): Promise<Event[]>;
export declare function getEventsByStreamFromSequence(client: Pool | PoolClient, streamId: string, fromSequence: number): Promise<Event[]>;
export declare function getMaxStreamSequence(client: Pool | PoolClient, streamId: string): Promise<number>;
export declare function appendEvent(client: Pool | PoolClient, params: AppendEventParams): Promise<Event>;
export declare function getEventHistory(client: Pool | PoolClient, streamId: string, limit: number, offset: number): Promise<Event[]>;
export declare function countEventsByStream(client: Pool | PoolClient, streamId: string): Promise<number>;
//# sourceMappingURL=events.d.ts.map