/**
 * API request/response types
 */

import type { MemberRole, PostStatus, TwitterPublishResult } from './domain.js'

// Authentication
export interface RequestMagicLinkRequest {
  email: string
}

export interface RequestMagicLinkResponse {
  message: string
}

export interface VerifyMagicLinkResponse {
  sessionId: string
  user: {
    id: string
    email: string
    displayName: string | null
    avatarUrl: string | null
  }
}

export interface GetCurrentUserResponse {
  id: string
  email: string
  displayName: string | null
  avatarUrl: string | null
}

// Organizations
export interface CreateOrganizationRequest {
  name: string
  slug: string
}

export interface UpdateOrganizationRequest {
  name?: string
  slug?: string
}

export interface OrganizationResponse {
  id: string
  name: string
  slug: string
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface ListOrganizationsResponse {
  organizations: OrganizationResponse[]
}

// Members
export interface AddMemberRequest {
  userId: string
  role: MemberRole
}

export interface MemberResponse {
  id: string
  organizationId: string
  userId: string
  userEmail: string
  userDisplayName: string | null
  role: MemberRole
  joinedAt: string
}

export interface ListMembersResponse {
  members: MemberResponse[]
}

// Invitations
export interface CreateInvitationRequest {
  email: string
  role: MemberRole
}

export interface InvitationResponse {
  id: string
  organizationId: string
  email: string
  role: MemberRole
  expiresAt: string
  createdAt: string
}

export interface ListInvitationsResponse {
  invitations: InvitationResponse[]
}

export interface AcceptInvitationResponse {
  organizationId: string
  role: MemberRole
}

// Posts (commands)
export interface SchedulePostRequest {
  content: string
  scheduledFor: string // ISO 8601
  mediaUrls?: string[]
}

export interface UpdatePostRequest {
  content: string
  scheduledFor: string // ISO 8601
}

export interface CancelPostRequest {
  reason: string
}

// Posts (queries)
export interface PostResponse {
  id: string
  organizationId: string
  createdBy: string
  createdByName: string | null
  content: string
  mediaUrls: string[]
  scheduledFor: string
  status: PostStatus
  publishedAt: string | null
  twitterResult: TwitterPublishResult | null
  createdAt: string
  updatedAt: string
}

export interface ListPostsResponse {
  posts: PostResponse[]
  pagination?: {
    total: number
    page: number
    pageSize: number
  }
}

export interface ListPostsQuery {
  status?: PostStatus
  page?: number
  pageSize?: number
}

// Event history
export interface EventHistoryResponse {
  events: Array<{
    id: string
    eventType: string
    payload: unknown
    metadata: {
      userId: string
      timestamp: string
    }
    sequence: number
    createdAt: string
  }>
  pagination?: {
    total: number
    page: number
    pageSize: number
  }
}

// Twitter
export interface TwitterAuthResponse {
  authUrl: string
}

export interface TwitterAccountResponse {
  id: string
  accountName: string
  accountId: string
  connectedAt: string
}

export interface TwitterPreviewRequest {
  content: string
  mediaUrls?: string[]
}

export interface TwitterPreviewResponse {
  content: string
  characterCount: number
  mediaCount: number
  isValid: boolean
  errors?: string[]
}

// Generic error response
export interface ErrorResponse {
  error: string
  code?: string
  details?: unknown
}
