/**
 * Domain entity types for Screeem platform
 */

// User entity (traditional CRUD)
export interface User {
  id: string
  email: string
  emailVerified: boolean
  displayName: string | null
  avatarUrl: string | null
  createdAt: Date
  updatedAt: Date
}

// Organization entity (traditional CRUD)
export interface Organization {
  id: string
  name: string
  slug: string
  ownerId: string
  createdAt: Date
  updatedAt: Date
  version: number
}

// Organization member (traditional CRUD)
export type MemberRole = 'owner' | 'admin' | 'member'

export interface OrganizationMember {
  id: string
  organizationId: string
  userId: string
  role: MemberRole
  joinedAt: Date
}

// Invitation (traditional CRUD)
export interface Invitation {
  id: string
  organizationId: string
  email: string
  role: MemberRole
  token: string
  invitedBy: string
  expiresAt: Date
  acceptedAt: Date | null
  createdAt: Date
}

// Twitter account (traditional CRUD)
export interface TwitterAccount {
  id: string
  organizationId: string
  accountName: string
  accountId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  connectedBy: string
  createdAt: Date
  updatedAt: Date
}

// Scheduled post (READ MODEL - projected from events)
export type PostStatus = 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'

export interface ScheduledPost {
  id: string
  organizationId: string
  createdBy: string
  content: string
  mediaUrls: string[]
  scheduledFor: Date
  status: PostStatus
  publishedAt: Date | null
  twitterResult: TwitterPublishResult | null
  createdAt: Date
  updatedAt: Date
  version: number
}

export interface TwitterPublishResult {
  tweetId?: string
  error?: string
  publishedAt?: string
}

// Magic link token
export interface MagicLink {
  id: string
  email: string
  token: string
  expiresAt: Date
  usedAt: Date | null
  createdAt: Date
}

// Session
export interface Session {
  id: string
  userId: string
  expiresAt: Date
}
