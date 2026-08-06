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
        className="max-w-48 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 outline-none focus:ring-2 focus:ring-gray-900"
      >
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
      <button
        onClick={() => setCreating((value) => !value)}
        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        aria-label="Create team"
      >
        +
      </button>
      {creating && (
        <form onSubmit={createTeam} className="absolute left-0 top-11 z-10 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <label className="mb-1 block text-xs font-medium text-gray-600">New team name</label>
          <div className="flex gap-2">
            <input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-900" />
            <button disabled={busy || !name.trim()} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Create</button>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </form>
      )}
    </div>
  );
}
