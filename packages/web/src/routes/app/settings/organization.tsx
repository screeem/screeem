import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  useOrganizations,
  useCreateOrganization,
  useUpdateOrganization,
  useOrganizationMembers,
  useCreateInvitation,
  useInvitations,
  useRemoveMember,
} from '../../../lib/api/hooks'
import { useAuth } from '../../../lib/auth/context'

export const Route = createFileRoute('/app/settings/organization')({
  component: OrganizationSettingsComponent,
})

function OrganizationSettingsComponent() {
  const { user } = useAuth()
  const { data: organizations, isLoading: orgsLoading } = useOrganizations()
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')

  // Select first org by default
  const selectedOrg = organizations?.find((org: any) => org.id === selectedOrgId) || organizations?.[0]

  if (!selectedOrgId && selectedOrg) {
    setSelectedOrgId(selectedOrg.id)
  }

  if (orgsLoading) {
    return <div className="text-muted-foreground">Loading organizations...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Organization Settings</h2>
        <p className="text-muted-foreground">
          Manage your organizations and team members
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Organization List */}
        <div className="space-y-4">
          <OrganizationList
            organizations={organizations || []}
            selectedId={selectedOrgId}
            onSelect={setSelectedOrgId}
          />
          <CreateOrganizationForm />
        </div>

        {/* Organization Details */}
        {selectedOrg && (
          <div className="lg:col-span-2 space-y-6">
            <OrganizationDetails organization={selectedOrg} />
            <MembersSection organizationId={selectedOrg.id} currentUserId={user!.id} />
            <InvitationsSection organizationId={selectedOrg.id} />
          </div>
        )}
      </div>
    </div>
  )
}

function OrganizationList({
  organizations,
  selectedId,
  onSelect,
}: {
  organizations: any[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-semibold mb-3">Your Organizations</h3>
      <div className="space-y-2">
        {organizations.map((org: any) => (
          <button
            key={org.id}
            onClick={() => onSelect(org.id)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              selectedId === org.id
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-secondary'
            }`}
          >
            <div className="font-medium">{org.name}</div>
            <div className="text-xs opacity-75">{org.slug}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function CreateOrganizationForm() {
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const createMutation = useCreateOrganization()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({ name, slug })
      setName('')
      setSlug('')
      setIsOpen(false)
    } catch (error: any) {
      alert(error.message)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full rounded-lg border-2 border-dashed border-border p-4 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
      >
        + Create New Organization
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-semibold mb-3">New Organization</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              // Auto-generate slug
              setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            required
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function OrganizationDetails({ organization }: { organization: any }) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(organization.name)
  const updateMutation = useUpdateOrganization(organization.id)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await updateMutation.mutateAsync({ name })
      setIsEditing(false)
    } catch (error: any) {
      alert(error.message)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Organization Details</h3>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-primary hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false)
                setName(organization.name)
              }}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-sm text-muted-foreground">Name</div>
            <div className="font-medium">{organization.name}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Slug</div>
            <div className="font-mono text-sm">{organization.slug}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">ID</div>
            <div className="font-mono text-xs">{organization.id}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function MembersSection({ organizationId, currentUserId }: { organizationId: string; currentUserId: string }) {
  const { data: members } = useOrganizationMembers(organizationId)
  const removeMutation = useRemoveMember(organizationId)

  const handleRemove = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return
    try {
      await removeMutation.mutateAsync(userId)
    } catch (error: any) {
      alert(error.message)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="text-lg font-semibold mb-4">Team Members</h3>
      <div className="space-y-3">
        {members?.map((member: any) => (
          <div key={member.userId} className="flex items-center justify-between py-2">
            <div>
              <div className="font-medium">{member.email || member.userId}</div>
              <div className="text-xs text-muted-foreground capitalize">{member.role}</div>
            </div>
            {member.userId !== currentUserId && (
              <button
                onClick={() => handleRemove(member.userId)}
                disabled={removeMutation.isPending}
                className="text-sm text-destructive hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {(!members || members.length === 0) && (
          <div className="text-sm text-muted-foreground">No members yet</div>
        )}
      </div>
    </div>
  )
}

function InvitationsSection({ organizationId }: { organizationId: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const { data: invitations } = useInvitations(organizationId)
  const createMutation = useCreateInvitation(organizationId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createMutation.mutateAsync({ email, role })
      setEmail('')
      setRole('member')
      setIsOpen(false)
    } catch (error: any) {
      alert(error.message)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Pending Invitations</h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-sm bg-primary text-primary-foreground px-3 py-1 rounded hover:bg-primary/90"
        >
          {isOpen ? 'Cancel' : '+ Invite'}
        </button>
      </div>

      {isOpen && (
        <form onSubmit={handleSubmit} className="mb-4 p-4 bg-secondary rounded-md space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Sending...' : 'Send Invitation'}
          </button>
        </form>
      )}

      <div className="space-y-2">
        {invitations?.filter((inv: any) => !inv.acceptedAt).map((invitation: any) => (
          <div key={invitation.id} className="flex items-center justify-between py-2 text-sm">
            <div>
              <div>{invitation.email}</div>
              <div className="text-xs text-muted-foreground capitalize">{invitation.role}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              Expires {new Date(invitation.expiresAt).toLocaleDateString()}
            </div>
          </div>
        ))}
        {(!invitations || invitations.every((inv: any) => inv.acceptedAt)) && (
          <div className="text-sm text-muted-foreground">No pending invitations</div>
        )}
      </div>
    </div>
  )
}
