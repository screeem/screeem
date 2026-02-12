import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { organizationsApi, membersApi, invitationsApi, postsApi, twitterApi } from './client'

// Organizations
export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.list(),
  })
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: ['organizations', id],
    queryFn: () => organizationsApi.get(id),
    enabled: !!id,
  })
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; slug: string }) => organizationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
    },
  })
}

export function useUpdateOrganization(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name?: string }) => organizationsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', id] })
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
    },
  })
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => organizationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
    },
  })
}

// Members
export function useOrganizationMembers(orgId: string) {
  return useQuery({
    queryKey: ['organizations', orgId, 'members'],
    queryFn: () => membersApi.list(orgId),
    enabled: !!orgId,
  })
}

export function useAddMember(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { userId: string; role: string }) => membersApi.add(orgId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'members'] })
    },
  })
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) => membersApi.remove(orgId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'members'] })
    },
  })
}

// Invitations
export function useInvitations(orgId: string) {
  return useQuery({
    queryKey: ['organizations', orgId, 'invites'],
    queryFn: () => invitationsApi.list(orgId),
    enabled: !!orgId,
  })
}

export function useCreateInvitation(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { email: string; role: string }) => invitationsApi.create(orgId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'invites'] })
    },
  })
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (token: string) => invitationsApi.accept(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
    },
  })
}

// Posts
export function usePosts(
  orgId: string,
  params?: { status?: string; limit?: number; offset?: number }
) {
  return useQuery({
    queryKey: ['organizations', orgId, 'posts', params],
    queryFn: () => postsApi.list(orgId, params),
    enabled: !!orgId,
  })
}

export function usePost(orgId: string, postId: string) {
  return useQuery({
    queryKey: ['organizations', orgId, 'posts', postId],
    queryFn: () => postsApi.get(orgId, postId),
    enabled: !!orgId && !!postId,
  })
}

export function useSchedulePost(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { content: string; scheduledFor: string; mediaUrls?: string[] }) =>
      postsApi.schedule(orgId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'posts'] })
    },
  })
}

export function useUpdatePost(orgId: string, postId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { content?: string; scheduledFor?: string }) =>
      postsApi.update(orgId, postId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'posts', postId] })
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'posts'] })
    },
  })
}

export function useCancelPost(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, reason }: { postId: string; reason?: string }) =>
      postsApi.cancel(orgId, postId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'posts'] })
    },
  })
}

export function usePostEvents(orgId: string, params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['organizations', orgId, 'posts', 'events', params],
    queryFn: () => postsApi.getEvents(orgId, params),
    enabled: !!orgId,
  })
}

// Twitter
export function useTwitterAuthUrl(orgId: string) {
  return useQuery({
    queryKey: ['organizations', orgId, 'twitter', 'auth'],
    queryFn: () => twitterApi.getAuthUrl(orgId),
    enabled: false, // Only fetch when explicitly called
  })
}

export function useTwitterAccount(orgId: string) {
  return useQuery({
    queryKey: ['organizations', orgId, 'twitter', 'account'],
    queryFn: () => twitterApi.getAccount(orgId),
    enabled: !!orgId,
    retry: false, // Don't retry if not connected
  })
}

export function useDisconnectTwitter(orgId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => twitterApi.disconnect(orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'twitter', 'account'] })
    },
  })
}
