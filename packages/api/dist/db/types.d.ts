/**
 * Database types matching the schema
 */
export interface Event {
    id: string;
    stream_id: string;
    stream_type: string;
    event_type: string;
    event_version: number;
    payload: unknown;
    metadata: unknown;
    sequence: number;
    stream_sequence: number;
    created_at: Date;
}
export interface Snapshot {
    id: string;
    stream_id: string;
    stream_type: string;
    sequence: number;
    state: unknown;
    created_at: Date;
}
export interface User {
    id: string;
    email: string;
    email_verified: boolean;
    display_name: string | null;
    avatar_url: string | null;
    created_at: Date;
    updated_at: Date;
}
export interface MagicLink {
    id: string;
    email: string;
    token: string;
    expires_at: Date;
    used_at: Date | null;
    created_at: Date;
}
export interface Session {
    id: string;
    user_id: string;
    expires_at: Date;
    created_at: Date;
}
export interface SessionWithUser extends Session {
    email: string;
    display_name: string | null;
    avatar_url: string | null;
}
export interface Organization {
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    created_at: Date;
    updated_at: Date;
    version: number;
}
export interface OrganizationMember {
    id: string;
    organization_id: string;
    user_id: string;
    role: string;
    joined_at: Date;
}
export interface OrganizationMemberWithUser extends OrganizationMember {
    email: string;
    display_name: string | null;
    avatar_url: string | null;
}
export interface Invitation {
    id: string;
    organization_id: string;
    email: string;
    role: string;
    token: string;
    invited_by: string;
    expires_at: Date;
    accepted_at: Date | null;
    created_at: Date;
}
export interface TwitterAccount {
    id: string;
    organization_id: string;
    account_name: string;
    account_id: string;
    access_token: string;
    refresh_token: string | null;
    expires_at: Date | null;
    connected_by: string;
    created_at: Date;
    updated_at: Date;
}
export interface ScheduledPost {
    id: string;
    organization_id: string;
    created_by: string;
    content: string;
    media_urls: unknown;
    scheduled_for: Date;
    status: string;
    published_at: Date | null;
    twitter_result: unknown | null;
    created_at: Date;
    updated_at: Date;
    version: number;
}
export interface ScheduledPostWithUser extends ScheduledPost {
    created_by_name: string | null;
}
//# sourceMappingURL=types.d.ts.map