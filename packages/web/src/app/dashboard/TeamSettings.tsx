"use client";

import { useState } from "react";
import type { TeamRole } from "@/lib/teams/server";

export type TeamMemberView = {
  userId: string;
  email: string;
  role: TeamRole;
};

export type TeamInvitationView = {
  id: string;
  email: string;
  role: "admin" | "member";
  token: string;
  expiresAt: string;
};

export function TeamSettings({
  team,
  members,
  invitations,
}: {
  team: { id: string; name: string; role: TeamRole };
  members: TeamMemberView[];
  invitations: TeamInvitationView[];
}) {
  const canManage = team.role === "owner" || team.role === "admin";
  const [name, setName] = useState(team.name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedInvitationId, setCopiedInvitationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch(`/api/teams/${team.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (response.ok) window.location.reload();
    else setError("Could not rename the team");
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/teams/${team.id}/invitations`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) {
      setInviteUrl(body.inviteUrl);
      setEmail("");
    } else setError(body.error ?? "Could not create invitation");
  }

  async function updateMember(userId: string, nextRole: "admin" | "member") {
    setBusy(true);
    const response = await fetch(`/api/teams/${team.id}/members/${userId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: nextRole }),
    });
    if (response.ok) window.location.reload();
    else {
      setError("Could not update member");
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm("Remove this person from the team?")) return;
    setBusy(true);
    const response = await fetch(`/api/teams/${team.id}/members/${userId}`, { method: "DELETE" });
    if (response.ok) window.location.reload();
    else {
      setError("Could not remove member");
      setBusy(false);
    }
  }

  function copyInvite() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyPendingInvite(invitation: TeamInvitationView) {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${invitation.token}`);
    setCopiedInvitationId(invitation.id);
    setTimeout(() => setCopiedInvitationId(null), 2000);
  }

  async function revokeInvitation(invitationId: string) {
    setBusy(true);
    const response = await fetch(`/api/teams/${team.id}/invitations/${invitationId}`, { method: "DELETE" });
    if (response.ok) window.location.reload();
    else {
      setError("Could not revoke invitation");
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Team</h2>
      <p className="mb-6 text-sm text-gray-500">Share connected accounts and Screeem access with your team.</p>

      {canManage && (
        <form onSubmit={rename} className="mb-6 flex max-w-lg items-end gap-2">
          <label className="flex-1 text-sm font-medium text-gray-700">Team name
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900" />
          </label>
          <button disabled={busy || !name.trim() || name === team.name} className="rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">Save</button>
        </form>
      )}

      <h3 className="mb-2 text-sm font-medium text-gray-700">Members</h3>
      <div className="max-w-2xl divide-y divide-gray-100 rounded-md border border-gray-200">
        {members.map((member) => (
          <div key={member.userId} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-gray-800">{member.email}</span>
            {canManage && member.role !== "owner" ? (
              <select disabled={busy || (team.role !== "owner" && member.role === "admin")} value={member.role} onChange={(event) => updateMember(member.userId, event.target.value as "admin" | "member")} className="rounded border border-gray-200 px-2 py-1 text-xs">
                <option value="member">Member</option>
                {team.role === "owner" && <option value="admin">Admin</option>}
              </select>
            ) : <span className="capitalize text-xs text-gray-500">{member.role}</span>}
            {canManage && member.role !== "owner" && !(team.role === "admin" && member.role === "admin") && (
              <button disabled={busy} onClick={() => removeMember(member.userId)} className="text-xs text-red-600 hover:underline">Remove</button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="mt-6 max-w-2xl">
          <h3 className="mb-2 text-sm font-medium text-gray-700">Invite someone</h3>
          <form onSubmit={invite} className="flex gap-2">
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900" />
            <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "member")} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="member">Member</option>
              {team.role === "owner" && <option value="admin">Admin</option>}
            </select>
            <button disabled={busy} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">Invite</button>
          </form>
          {inviteUrl && (
            <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-800">
              Invitation created. <button onClick={copyInvite} className="font-medium underline">{copied ? "Copied!" : "Copy invite link"}</button>
            </div>
          )}
          {invitations.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Pending invitations</h4>
              <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-gray-700">{invitation.email}</span>
                    <span className="text-xs capitalize text-gray-500">{invitation.role}</span>
                    <button type="button" onClick={() => copyPendingInvite(invitation)} className="text-xs text-gray-600 hover:underline">{copiedInvitationId === invitation.id ? "Copied!" : "Copy link"}</button>
                    <button type="button" disabled={busy} onClick={() => revokeInvitation(invitation.id)} className="text-xs text-red-600 hover:underline">Revoke</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}
