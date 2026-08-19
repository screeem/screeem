"use client";

import { useState } from "react";
import type { UserTeam } from "@/lib/teams/server";

export function TeamSwitcher({ teams, activeTeamId }: { teams: UserTeam[]; activeTeamId: string }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTeam(teamId: string) {
    setBusy(true);
    const response = await fetch("/api/teams/current", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    if (response.ok) window.location.reload();
    else {
      setError("Could not switch team");
      setBusy(false);
    }
  }

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (response.ok) window.location.reload();
    else {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not create team");
      setBusy(false);
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      <select
        aria-label="Current team"
        value={activeTeamId}
        disabled={busy}
        onChange={(event) => switchTeam(event.target.value)}
        className="max-w-48 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring"
      >
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
      <button
        onClick={() => setCreating((value) => !value)}
        className="rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent"
        aria-label="Create team"
      >
        +
      </button>
      {creating && (
        <form onSubmit={createTeam} className="absolute left-0 top-11 z-10 w-72 rounded-lg border border-border bg-card p-3 shadow-md">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">New team name</label>
          <div className="flex gap-2">
            <input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            <button disabled={busy || !name.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">Create</button>
          </div>
          {error && <p className="mt-2 text-xs text-error-text">{error}</p>}
        </form>
      )}
    </div>
  );
}
