import { supabase } from '../supabase'

const API_URL = import.meta.env.VITE_API_URL

async function getAuthHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    throw new Error('No active session')
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders()

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || response.statusText)
  }

  return response.json()
}

// Organizations API
export const organizationsApi = {
  list: () => request<any[]>('/api/organizations'),

  get: (id: string) => request<any>(`/api/organizations/${id}`),

  create: (data: { name: string; slug: string }) =>
    request<any>('/api/organizations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string }) =>
    request<any>(`/api/organizations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/organizations/${id}`, {
      method: 'DELETE',
    }),
}

// Organization Members API
export const membersApi = {
  list: (orgId: string) => request<any[]>(`/api/organizations/${orgId}/members`),

  add: (orgId: string, data: { userId: string; role: string }) =>
    request<any>(`/api/organizations/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  remove: (orgId: string, userId: string) =>
    request<void>(`/api/organizations/${orgId}/members/${userId}`, {
      method: 'DELETE',
    }),
}

// Invitations API
export const invitationsApi = {
  list: (orgId: string) => request<any[]>(`/api/organizations/${orgId}/invites`),

  create: (orgId: string, data: { email: string; role: string }) =>
    request<any>(`/api/organizations/${orgId}/invites`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  accept: (token: string) =>
    request<any>(`/api/invites/${token}/accept`, {
      method: 'POST',
    }),
}

// Posts API
export const postsApi = {
  list: (orgId: string, params?: { status?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.status) searchParams.append('status', params.status)
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.offset) searchParams.append('offset', params.offset.toString())

    const query = searchParams.toString()
    return request<any>(`/api/organizations/${orgId}/posts${query ? `?${query}` : ''}`)
  },

  get: (orgId: string, postId: string) =>
    request<any>(`/api/organizations/${orgId}/posts/${postId}`),

  schedule: (
    orgId: string,
    data: { content: string; scheduledFor: string; mediaUrls?: string[] }
  ) =>
    request<any>(`/api/organizations/${orgId}/posts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (orgId: string, postId: string, data: { content?: string; scheduledFor?: string }) =>
    request<any>(`/api/organizations/${orgId}/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  cancel: (orgId: string, postId: string, reason?: string) =>
    request<void>(`/api/organizations/${orgId}/posts/${postId}`, {
      method: 'DELETE',
      body: reason ? JSON.stringify({ reason }) : undefined,
    }),

  getEvents: (orgId: string, params?: { limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.append('limit', params.limit.toString())
    if (params?.offset) searchParams.append('offset', params.offset.toString())

    const query = searchParams.toString()
    return request<any>(`/api/organizations/${orgId}/posts/events/history${query ? `?${query}` : ''}`)
  },
}

// Twitter API
export const twitterApi = {
  getAuthUrl: (orgId: string) =>
    request<{ url: string }>(`/api/organizations/${orgId}/twitter/auth`),

  getAccount: (orgId: string) =>
    request<any>(`/api/organizations/${orgId}/twitter/account`),

  disconnect: (orgId: string) =>
    request<void>(`/api/organizations/${orgId}/twitter/account`, {
      method: 'DELETE',
    }),
}
